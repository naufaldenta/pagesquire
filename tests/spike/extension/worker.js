// Phase 4D-0 spike: measures whether chrome.debugger can deliver trusted input
// to nonce-tagged nodes, hit-test them first, and reach cross-origin frames.
// It deliberately has no grants or signatures; see docs/companion-extension.md.

const bootId = crypto.randomUUID();
const bootedAt = Date.now();
/** tabId -> Map(sessionId -> { targetId, type, url, parent }) */
const sessions = new Map();
const events = [];

class SpikeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const send = (target, method, params = {}) =>
  chrome.debugger.sendCommand(target, method, params);
const autoAttach = (target) =>
  send(target, 'Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Target.attachedToTarget') {
    const children = sessions.get(source.tabId) ?? new Map();
    sessions.set(source.tabId, children);
    children.set(params.sessionId, {
      targetId: params.targetInfo.targetId,
      type: params.targetInfo.type,
      url: params.targetInfo.url,
      parent: source.sessionId ?? null,
    });
    // Auto-attach is not recursive: repeat it inside each child.
    autoAttach({ tabId: source.tabId, sessionId: params.sessionId }).catch(
      () => {},
    );
  } else if (method === 'Target.detachedFromTarget') {
    sessions.get(source.tabId)?.delete(params.sessionId);
  } else if (method === 'Target.targetInfoChanged') {
    for (const child of sessions.get(source.tabId)?.values() ?? [])
      if (child.targetId === params.targetInfo.targetId)
        child.url = params.targetInfo.url;
  }
});
chrome.debugger.onDetach.addListener((source, reason) => {
  events.push({ event: 'detach', tabId: source.tabId, reason, at: Date.now() });
  sessions.delete(source.tabId);
});

function frameSession(tabId, frame) {
  if (!frame) return undefined;
  for (const [sessionId, child] of sessions.get(tabId) ?? [])
    if (child.type === 'iframe' && child.url.includes(frame)) return sessionId;
  throw new SpikeError('FRAME_MISSING', `No attached frame matches ${frame}.`);
}

async function resolve(target, nonce) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(nonce)) throw new SpikeError('BAD_NONCE');
  const { root } = await send(target, 'DOM.getDocument', { depth: 0 });
  const { nodeId } = await send(target, 'DOM.querySelector', {
    nodeId: root.nodeId,
    selector: `[data-pagesquire-target="${nonce}"]`,
  });
  if (!nodeId) throw new SpikeError('TARGET_MISSING');
  const { node } = await send(target, 'DOM.describeNode', { nodeId });
  return { nodeId, node };
}

/** Invariant 5, judged from CDP rather than from what the page reports. */
async function refuseSensitive(target, nodeId, node) {
  const attributes = {};
  for (let i = 0; i < (node.attributes ?? []).length; i += 2)
    attributes[node.attributes[i].toLowerCase()] = node.attributes[i + 1];
  const type = (attributes.type ?? '').toLowerCase();
  const autocomplete = (attributes.autocomplete ?? '').toLowerCase();
  if (
    (node.nodeName === 'INPUT' && ['password', 'file'].includes(type)) ||
    /\b(?:one-time-code|cc-[a-z-]+|current-password|new-password)\b/.test(
      autocomplete,
    )
  )
    throw new SpikeError('TARGET_NOT_ALLOWED', 'Sensitive input.');
  const { object } = await send(target, 'DOM.resolveNode', {
    nodeId,
    objectGroup: 'spike',
  });
  const { result } = await send(target, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration:
      'function () { return Boolean(this.closest("[data-pagesquire-private]")); }',
    returnByValue: true,
  });
  if (result.value)
    throw new SpikeError('TARGET_NOT_ALLOWED', 'Private region.');
}

/** Frame owners from the top document down to `sessionId`, with offsets. */
async function frameChain(tabId, sessionId) {
  const levels = [];
  for (let current = sessionId; current;) {
    const child = sessions.get(tabId)?.get(current);
    if (!child) throw new SpikeError('FRAME_MISSING');
    const parent = child.parent
      ? { tabId, sessionId: child.parent }
      : { tabId };
    await send(parent, 'DOM.getDocument', { depth: 0 });
    const { backendNodeId } = await send(parent, 'DOM.getFrameOwner', {
      frameId: child.targetId,
    });
    levels.unshift({ parent, owner: backendNodeId });
    current = child.parent;
  }
  let x = 0;
  let y = 0;
  for (const level of levels) {
    await send(level.parent, 'DOM.scrollIntoViewIfNeeded', {
      backendNodeId: level.owner,
    });
    const { model } = await send(level.parent, 'DOM.getBoxModel', {
      backendNodeId: level.owner,
    });
    level.offset = { x, y };
    x += model.content[0];
    y += model.content[1];
  }
  return { levels, offset: { x, y } };
}

async function contains(target, outer, hit) {
  if (outer === hit) return true;
  const resolveObject = async (backendNodeId) =>
    (
      await send(target, 'DOM.resolveNode', {
        backendNodeId,
        objectGroup: 'spike',
      })
    ).object.objectId;
  const [outerId, hitId] = await Promise.all([
    resolveObject(outer),
    resolveObject(hit),
  ]);
  const { result } = await send(target, 'Runtime.callFunctionOn', {
    objectId: outerId,
    functionDeclaration: 'function (hit) { return this.contains(hit); }',
    arguments: [{ objectId: hitId }],
    returnByValue: true,
  });
  return result.value === true;
}

/** Invariant 4: the point must land on the node, through every frame owner. */
async function hitTest(target, levels, offset, node, point) {
  // Quads and Input use viewport coordinates, but getNodeForLocation takes
  // document coordinates (and only finds visible nodes), so add each
  // document's scroll offset as the renderer reports it, not as page JS does.
  const at = async (where, origin) => {
    const { cssLayoutViewport: scroll } = await send(
      where,
      'Page.getLayoutMetrics',
    );
    return (
      await send(where, 'DOM.getNodeForLocation', {
        x: Math.round(point.x - origin.x + scroll.pageX),
        y: Math.round(point.y - origin.y + scroll.pageY),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      })
    ).backendNodeId;
  };
  for (const level of levels)
    if ((await at(level.parent, level.offset)) !== level.owner)
      throw new SpikeError('OBSCURED', 'A frame owner is covered.');
  const hit = await at(target, offset);
  if (!(await contains(target, node.backendNodeId, hit)))
    throw new SpikeError('OBSCURED', 'Another element covers the target.');
}

async function act(tabId, { kind, nonce, frame, text, key }) {
  const started = performance.now();
  const timings = {};
  const lap = (name) => {
    timings[name] = Math.round((performance.now() - started) * 10) / 10;
  };
  const sessionId = frameSession(tabId, frame);
  const target = sessionId ? { tabId, sessionId } : { tabId };
  try {
    if (kind === 'key') {
      await pressKey(tabId, key);
      lap('dispatch');
      return { ok: true, timings };
    }
    const { nodeId, node } = await resolve(target, nonce);
    lap('resolve');
    await refuseSensitive(target, nodeId, node);
    lap('inspect');
    const { levels, offset } = sessionId
      ? await frameChain(tabId, sessionId)
      : { levels: [], offset: { x: 0, y: 0 } };
    await send(target, 'DOM.scrollIntoViewIfNeeded', { nodeId });
    const { quads } = await send(target, 'DOM.getContentQuads', { nodeId });
    if (!quads.length) throw new SpikeError('NOT_VISIBLE');
    const quad = quads[0];
    const point = {
      x: Math.round(offset.x + (quad[0] + quad[2] + quad[4] + quad[6]) / 4),
      y: Math.round(offset.y + (quad[1] + quad[3] + quad[5] + quad[7]) / 4),
    };
    lap('locate');
    await hitTest(target, levels, offset, node, point);
    lap('hitTest');
    if (kind === 'click') {
      // Input always goes to the top-level page; Chrome routes it into frames.
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await send({ tabId }, 'Input.dispatchMouseEvent', {
          type,
          x: point.x,
          y: point.y,
          button: type === 'mouseMoved' ? 'none' : 'left',
          buttons: type === 'mousePressed' ? 1 : 0,
          clickCount: type === 'mouseMoved' ? 0 : 1,
        });
    } else if (kind === 'type') {
      await send(target, 'DOM.focus', { nodeId });
      await send({ tabId }, 'Input.insertText', { text: String(text) });
    } else throw new SpikeError('BAD_KIND');
    lap('dispatch');
    return { ok: true, point, timings };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'CDP_ERROR',
      message: error.message,
    };
  } finally {
    send(target, 'Runtime.releaseObjectGroup', { objectGroup: 'spike' }).catch(
      () => {},
    );
  }
}

async function pressKey(tabId, key) {
  const keys = { Enter: { code: 'Enter', keyCode: 13, text: '\r' } };
  const spec = keys[key];
  if (!spec) throw new SpikeError('BAD_KEY');
  const base = {
    key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
  };
  await send({ tabId }, 'Input.dispatchKeyEvent', {
    ...base,
    type: 'keyDown',
    text: spec.text,
  });
  await send({ tabId }, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

const operations = {
  async status() {
    const targets = await chrome.debugger.getTargets();
    return {
      bootId,
      bootedAt,
      attachedTabs: targets
        .filter((t) => t.attached && t.tabId !== undefined)
        .map((t) => t.tabId),
      events,
    };
  },
  async attach(tabId) {
    const started = performance.now();
    await chrome.debugger.attach({ tabId }, '1.3');
    const attached = performance.now();
    await autoAttach({ tabId });
    return {
      attachMs: Math.round(attached - started),
      autoAttachMs: Math.round(performance.now() - attached),
    };
  },
  async detach(tabId) {
    await chrome.debugger.detach({ tabId });
    sessions.delete(tabId);
    return { detached: true };
  },
  async frames(tabId) {
    return [...(sessions.get(tabId) ?? [])].map(([sessionId, child]) => ({
      sessionId,
      ...child,
    }));
  },
  act,
  /** Reading path without CDP: content scripts injected into all frames. */
  async readFrames(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        origin: location.origin,
        text: (document.body?.innerText ?? '').slice(0, 200),
      }),
    });
    return results.map((r) => ({ frameId: r.frameId, ...r.result }));
  },
  /** Reading path through CDP: the frame's accessibility tree. */
  async axNames(tabId, { frame }) {
    const sessionId = frameSession(tabId, frame);
    const { nodes } = await send(
      sessionId ? { tabId, sessionId } : { tabId },
      'Accessibility.getFullAXTree',
    );
    return nodes
      .filter((n) => !n.ignored && n.name?.value)
      .map((n) => `${n.role?.value}: ${n.name.value}`);
  },
};

async function run(tabId, op, args = {}) {
  const operation = operations[op];
  if (!operation) return { ok: false, code: 'BAD_OP' };
  try {
    return await operation(tabId, args);
  } catch (error) {
    return { ok: false, code: error.code ?? 'ERROR', message: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  run(sender.tab?.id, message.op, message.args).then(reply);
  return true;
});
