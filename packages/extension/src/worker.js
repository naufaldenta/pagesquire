// PageSquire companion service worker. It owns every decision: which sites,
// frames and tabs are in scope, when the debugger is attached, and whether
// one input may run. Pages, frames, tabs, servers and models only ask.
// See docs/companion-extension.md.
import {
  FEATURES,
  FRAME_NAME,
  FRAME_TARGET,
  IDLE_DETACH_MS,
  KEYS,
  MAX_FRAMES,
  MAX_MANIFEST_BYTES,
  MAX_TABS,
  PROTOCOL,
  RateLimiter,
  UsedCalls,
  auditEntry,
  frameScope,
  invalidAction,
  isTestOrigin,
  originPattern,
  sensitiveReason,
  validateSiteManifest,
  verifySignedAction,
} from './policy.js';

/** tabId -> { origin, idleTimer } while the debugger is attached. */
const sessions = new Map();
/** tabId -> Map(sessionId -> { targetId, type, url, parent }) for frames. */
const children = new Map();
/** tabId -> tail of that tab's action queue. */
const queues = new Map();
/** tabId -> tail of that tab's frame-registry updates. */
const frameQueues = new Map();
const limiter = new RateLimiter();

class ActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const send = (target, method, params = {}) =>
  chrome.debugger.sendCommand(target, method, params);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const autoAttach = (target) =>
  send(target, 'Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

// Storage: grants survive restarts; stops, frames and the audit log last
// the browser session.
async function grants() {
  return (await chrome.storage.local.get('grants')).grants ?? {};
}
async function stoppedTabs() {
  return new Set((await chrome.storage.session.get('stopped')).stopped ?? []);
}
async function setStopped(tabId, stopped) {
  const tabs = await stoppedTabs();
  if (stopped) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ stopped: [...tabs] });
}
async function audit(entry) {
  const { audit = [] } = await chrome.storage.session.get('audit');
  audit.push(auditEntry(entry));
  await chrome.storage.session.set({ audit: audit.slice(-100) });
}
async function idleDetachMs() {
  // Test hook kept in local storage, out of reach of pages; clamped.
  const { idleDetachMs: value } =
    await chrome.storage.local.get('idleDetachMs');
  return Number.isInteger(value)
    ? Math.min(Math.max(value, 1000), 300000)
    : IDLE_DETACH_MS;
}

/**
 * The relay runs only on hosts with a grant, and the frame script only on
 * granted frame hosts; the worker still checks exact origins.
 */
async function syncContentScripts() {
  const all = Object.values(await grants());
  const pages = [...new Set(all.map((grant) => originPattern(grant.origin)))];
  const frames = [
    ...new Set(all.flatMap((grant) => grant.frames ?? []).map(originPattern)),
  ];
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length)
    await chrome.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  const scripts = [];
  if (pages.length)
    scripts.push({
      id: 'relay',
      matches: pages,
      js: ['src/content.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    });
  // The remote script serves granted frames and, top-level on granted pages,
  // tabs that join a session. It does nothing until the worker says so.
  const remote = [...new Set([...pages, ...frames])];
  if (remote.length)
    scripts.push({
      id: 'remote',
      matches: remote,
      js: ['dist/remote.js'],
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    });
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

async function fetchManifest(origin) {
  let response;
  try {
    response = await fetch(new URL('/.well-known/pagesquire.json', origin), {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return { valid: false, errors: ['The declaration could not be fetched.'] };
  }
  if (!response.ok)
    return {
      valid: false,
      errors: [`The site answered HTTP ${response.status}.`],
    };
  const text = await response.text();
  if (text.length > MAX_MANIFEST_BYTES)
    return { valid: false, errors: ['The declaration is too large.'] };
  try {
    return validateSiteManifest(JSON.parse(text));
  } catch {
    return { valid: false, errors: ['The declaration is not valid JSON.'] };
  }
}

async function badge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1d4ed8' });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // The tab may already be gone.
  }
}

/** Waits for the debugging bar to take its height before measuring targets. */
async function settleViewport(tabId) {
  const size = async () => {
    const { cssLayoutViewport: v } = await send(
      { tabId },
      'Page.getLayoutMetrics',
    );
    return `${v.clientWidth}x${v.clientHeight}`;
  };
  const first = await size();
  for (let waited = 0; waited < 300; waited += 50) {
    await sleep(50);
    const current = await size();
    if (current !== first) {
      await sleep(50);
      return;
    }
  }
}

async function attach(tabId, origin) {
  const existing = sessions.get(tabId);
  if (existing) return existing;
  await chrome.debugger.attach({ tabId }, '1.3');
  const session = { origin, idleTimer: undefined };
  sessions.set(tabId, session);
  await send({ tabId }, 'Page.enable');
  // Cross-origin frames become child sessions (Chrome 125 or newer).
  await autoAttach({ tabId });
  await settleViewport(tabId);
  await badge(tabId, 'ON');
  return session;
}

async function detach(tabId) {
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  children.delete(tabId);
  clearTimeout(session?.idleTimer);
  if (session)
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Already detached.
    }
  await badge(tabId, '');
}

async function stop(tabId, reason) {
  const origin = sessions.get(tabId)?.origin ?? '';
  await setStopped(tabId, true);
  await detach(tabId);
  // Stopping a page stops its whole session, including tabs that joined it.
  for (const member of Object.keys((await tabGroups())[tabId]?.members ?? {}))
    await detach(Number(member));
  await pushFrames(tabId);
  await pushTabs(tabId);
  await audit({ origin, kind: 'stop', ok: true, code: reason });
}

chrome.debugger.onDetach.addListener(async ({ tabId }, reason) => {
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  children.delete(tabId);
  clearTimeout(session?.idleTimer);
  await badge(tabId, '');
  // "Cancel" on Chrome's debugging bar is the visitor stopping it.
  if (session && reason === 'canceled_by_user')
    await stop(tabId, 'debugging bar');
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const { tabId } = source;
  if (method === 'Target.attachedToTarget') {
    const tabChildren = children.get(tabId) ?? new Map();
    children.set(tabId, tabChildren);
    tabChildren.set(params.sessionId, {
      targetId: params.targetInfo.targetId,
      type: params.targetInfo.type,
      url: params.targetInfo.url,
      parent: source.sessionId ?? null,
    });
    // Auto-attach is not recursive: repeat it inside each child.
    autoAttach({ tabId, sessionId: params.sessionId }).catch(() => {});
    return;
  }
  if (method === 'Target.detachedFromTarget') {
    children.get(tabId)?.delete(params.sessionId);
    return;
  }
  if (method === 'Target.targetInfoChanged') {
    for (const child of children.get(tabId)?.values() ?? [])
      if (child.targetId === params.targetInfo.targetId)
        child.url = params.targetInfo.url;
    return;
  }
  // Chrome keeps the debugger attached across navigations; scope is ours.
  const session = sessions.get(tabId);
  if (
    !session ||
    source.sessionId ||
    method !== 'Page.frameNavigated' ||
    params.frame.parentId
  )
    return;
  let origin;
  try {
    origin = new URL(params.frame.url).origin;
  } catch {
    origin = undefined;
  }
  if (origin !== session.origin) detach(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  children.delete(tabId);
  queues.delete(tabId);
  frameQueues.delete(tabId);
  limiter.forget(tabId);
  setStopped(tabId, false);
  chrome.storage.session.remove(`frames:${tabId}`);
  leaveTabs(tabId);
});

async function inScope(tabId, origin) {
  const tab = await chrome.tabs.get(tabId);
  try {
    return Boolean(tab.url) && new URL(tab.url).origin === origin;
  } catch {
    return false;
  }
}

/** The one node carrying the nonce in `target`, and its reserved-target checks. */
async function locate(target, nonce) {
  const { root } = await send(target, 'DOM.getDocument', { depth: 0 });
  const { nodeIds } = await send(target, 'DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: `[data-pagesquire-target="${nonce}"]`,
  });
  if (nodeIds.length !== 1) throw new ActionError('TARGET_MISSING');
  const nodeId = nodeIds[0];
  const { node } = await send(target, 'DOM.describeNode', { nodeId });
  if (sensitiveReason(node.nodeName, node.attributes))
    throw new ActionError('TARGET_NOT_ALLOWED');
  const { object } = await send(target, 'DOM.resolveNode', {
    nodeId,
    objectGroup: 'pagesquire',
  });
  const { result } = await send(target, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function () {
      return {
        reserved: Boolean(this.closest('[data-pagesquire-private]')),
        editable: this.matches('input, textarea') || this.isContentEditable,
      };
    }`,
    returnByValue: true,
  });
  if (result.value.reserved) throw new ActionError('TARGET_NOT_ALLOWED');
  return { nodeId, node, object, editable: result.value.editable };
}

/** Frame owners from the top document down to `sessionId`, with offsets. */
async function frameChain(tabId, sessionId) {
  const levels = [];
  for (let current = sessionId; current;) {
    const child = children.get(tabId)?.get(current);
    if (!child) throw new ActionError('TARGET_MISSING');
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

/**
 * The backend node at a viewport point of `target`'s document. Quads and
 * input use viewport coordinates; getNodeForLocation takes document
 * coordinates, so add the scroll offset the renderer reports.
 */
async function nodeAt(target, x, y) {
  const { cssLayoutViewport: scroll } = await send(
    target,
    'Page.getLayoutMetrics',
  );
  try {
    return (
      await send(target, 'DOM.getNodeForLocation', {
        x: Math.round(x + scroll.pageX),
        y: Math.round(y + scroll.pageY),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      })
    ).backendNodeId;
  } catch {
    throw new ActionError('OBSCURED');
  }
}

/**
 * Invariant 4: the click point is computed here and must land on the node,
 * through every frame owner on the way down.
 */
async function clickPoint(
  target,
  located,
  chain = { levels: [], offset: { x: 0, y: 0 } },
) {
  await send(target, 'DOM.scrollIntoViewIfNeeded', { nodeId: located.nodeId });
  const { quads } = await send(target, 'DOM.getContentQuads', {
    nodeId: located.nodeId,
  });
  if (!quads.length) throw new ActionError('NOT_VISIBLE');
  const quad = quads[0];
  const point = {
    x: Math.round(chain.offset.x + (quad[0] + quad[2] + quad[4] + quad[6]) / 4),
    y: Math.round(chain.offset.y + (quad[1] + quad[3] + quad[5] + quad[7]) / 4),
  };
  for (const level of chain.levels)
    if (
      (await nodeAt(
        level.parent,
        point.x - level.offset.x,
        point.y - level.offset.y,
      )) !== level.owner
    )
      throw new ActionError('OBSCURED');
  const hit = await nodeAt(
    target,
    point.x - chain.offset.x,
    point.y - chain.offset.y,
  );
  const { object: hitObject } = await send(target, 'DOM.resolveNode', {
    backendNodeId: hit,
    objectGroup: 'pagesquire',
  });
  const { result } = await send(target, 'Runtime.callFunctionOn', {
    objectId: located.object.objectId,
    functionDeclaration: 'function (hit) { return this.contains(hit); }',
    arguments: [{ objectId: hitObject.objectId }],
    returnByValue: true,
  });
  if (result.value !== true) throw new ActionError('OBSCURED');
  return point;
}

/** Input always goes to the top-level page; Chrome routes it into frames. */
async function dispatchClick(tabId, point) {
  // One session keeps command order, so the events need not wait in turn.
  await Promise.all(
    ['mouseMoved', 'mousePressed', 'mouseReleased'].map((type) =>
      send({ tabId }, 'Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      }),
    ),
  );
}

async function pressKey(tabId, name) {
  const key = KEYS[name];
  const base = {
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
  };
  await send({ tabId }, 'Input.dispatchKeyEvent', {
    ...base,
    type: key.text ? 'keyDown' : 'rawKeyDown',
    ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}),
  });
  await send({ tabId }, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

async function deliver(tabId, origin, args) {
  const target = { tabId };
  const located = await locate(target, args.nonce);
  if (args.kind === 'click') {
    const point = await clickPoint(target, located);
    if (!(await inScope(tabId, origin))) throw new ActionError('UNAVAILABLE');
    await dispatchClick(tabId, point);
    return;
  }
  if (args.kind === 'type' && !located.editable)
    throw new ActionError('TARGET_NOT_ALLOWED');
  await send(target, 'DOM.focus', { nodeId: located.nodeId });
  if (!(await inScope(tabId, origin))) throw new ActionError('UNAVAILABLE');
  if (args.kind === 'type')
    await send(target, 'Input.insertText', { text: args.text });
  else await pressKey(tabId, args.key);
}

// Frames: a registry per tab, kept in session storage so a restarted worker
// still knows which frame is which.
const frameKey = (tabId) => `frames:${tabId}`;
async function frameState(tabId) {
  return (
    (await chrome.storage.session.get(frameKey(tabId)))[frameKey(tabId)] ?? {
      entries: {},
    }
  );
}
const saveFrameState = (tabId, state) =>
  chrome.storage.session.set({ [frameKey(tabId)]: state });
async function frameEntry(tabId, name) {
  return Object.values((await frameState(tabId)).entries).find(
    (entry) => entry.name === name,
  );
}
async function framesFor(tabId) {
  if ((await stoppedTabs()).has(tabId)) return [];
  return Object.values((await frameState(tabId)).entries)
    .flatMap((entry) => (entry.frame ? [entry.frame] : []))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
async function pushFrames(tabId) {
  chrome.tabs
    .sendMessage(
      tabId,
      { type: 'pagesquire:frames', frames: await framesFor(tabId) },
      { frameId: 0 },
    )
    .catch(() => {});
}

// Tabs (4D-4): other same-origin tabs that joined a page's session, because
// that page opened them or the visitor shared them. The page with the chat
// is the controller, tab1; members are tab2 and later. Kept in session
// storage as { [controllerTabId]: { origin, seen, groupId,
// members: { [tabId]: { name, documentId, tab } }, invited: [tabId] } }.
// Invited tabs were shared by the visitor. Tabs opened from a session tab
// are remembered in `tabOpeners` and join only if their page confirms it.
const TABS_KEY = 'tabGroups';
const tabsQueue = new Map();
async function tabGroups() {
  return (await chrome.storage.session.get(TABS_KEY))[TABS_KEY] ?? {};
}
/** Every change to the session tabs runs in order. */
const withTabs = (task) =>
  queued(
    'tabs',
    async () => {
      const groups = await tabGroups();
      const result = await task(groups);
      await chrome.storage.session.set({ [TABS_KEY]: groups });
      return result;
    },
    tabsQueue,
  );
/** The controller and group a tab belongs to or is about to join. */
function groupOf(groups, tabId) {
  for (const [controller, group] of Object.entries(groups))
    if (group.members[tabId] || group.invited?.includes(Number(tabId)))
      return [Number(controller), group];
  return [];
}
const groupSize = (group) =>
  Object.keys(group.members).length + (group.invited?.length ?? 0);
function removeMember(group, tabId) {
  delete group.members[tabId];
  group.invited = (group.invited ?? []).filter((id) => id !== Number(tabId));
  chrome.tabs.ungroup(Number(tabId)).catch(() => {});
}
/** A closed tab leaves every group; a closed controller ends its group. */
async function leaveTabs(tabId) {
  const touched = await withTabs(async (groups) => {
    const { tabOpeners = {} } = await chrome.storage.session.get('tabOpeners');
    delete tabOpeners[tabId];
    await chrome.storage.session.set({ tabOpeners });
    const owners = [];
    for (const member of Object.keys(groups[tabId]?.members ?? {}))
      chrome.tabs.ungroup(Number(member)).catch(() => {});
    delete groups[tabId];
    for (const [controller, group] of Object.entries(groups))
      if (group.members[tabId] || group.invited?.includes(tabId)) {
        removeMember(group, tabId);
        owners.push(Number(controller));
      }
    return owners;
  });
  for (const controller of touched) await pushTabs(controller);
}
/** The visible tab group: a reminder of which tabs the assistant can use. */
async function groupTabs(controller, member) {
  const group = (await tabGroups())[controller];
  if (!group) return;
  const tabIds = [controller, member];
  let groupId;
  try {
    groupId = await chrome.tabs.group({ tabIds, groupId: group.groupId });
  } catch {
    try {
      groupId = await chrome.tabs.group({ tabIds });
    } catch {
      return; // The session works without the group.
    }
  }
  await chrome.tabGroups
    .update(groupId, { title: 'PageSquire', color: 'blue' })
    .catch(() => {});
  await withTabs((groups) => {
    if (groups[controller]) groups[controller].groupId = groupId;
  });
}
async function tabsFor(controller) {
  if ((await stoppedTabs()).has(controller)) return [];
  const list = [];
  for (const [id, member] of Object.entries(
    (await tabGroups())[controller]?.members ?? {},
  )) {
    if (!member.tab) continue;
    try {
      list.push({ ...member.tab, active: (await chrome.tabs.get(+id)).active });
    } catch {
      // Closed meanwhile.
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
async function pushTabs(controller) {
  chrome.tabs
    .sendMessage(
      controller,
      { type: 'pagesquire:tabs', tabs: await tabsFor(controller) },
      { frameId: 0 },
    )
    .catch(() => {});
}

/** Messages from the remote script running top-level in a tab. */
async function fromTab(message, sender) {
  const tabId = sender.tab?.id;
  const origin = sender.origin;
  // The relay in the same tab already forwards a trusted Escape.
  if (
    tabId === undefined ||
    !origin ||
    !sender.documentId ||
    message.op === 'inner-stop'
  )
    return { ok: false };
  const result = await withTabs(async (groups) => {
    let [controller, group] = groupOf(groups, tabId);
    // A tab opened from a session tab, possibly before that page said hello.
    if (!group && message.op === 'inner-hello' && message.opened === true) {
      const { tabOpeners = {} } =
        await chrome.storage.session.get('tabOpeners');
      const opener = tabOpeners[tabId];
      // The opener may not have said hello yet; a granted page of the same
      // origin can still own the tabs it opens.
      if (
        opener !== undefined &&
        !groups[opener] &&
        !groupOf(groups, opener)[1] &&
        (await tabOrigin(opener).catch(() => undefined)) === origin &&
        (await grants())[origin]
      )
        groups[opener] = { origin, members: {}, invited: [], seen: Date.now() };
      if (opener !== undefined)
        [controller, group] = groups[opener]
          ? [opener, groups[opener]]
          : groupOf(groups, opener);
      if (group && groupSize(group) >= MAX_TABS) group = undefined;
    }
    if (!group) return { ok: false };
    // Invariant 1: a tab that left the session's origin leaves the session.
    if (origin !== group.origin) {
      removeMember(group, tabId);
      return { ok: false, controller, changed: true };
    }
    if (message.op === 'inner-hello') {
      let joined = false;
      if (!group.members[tabId]) {
        // Chrome also names an opener for tabs the visitor opened by hand;
        // only a tab its page confirms was opened from the session joins.
        if (!group.invited?.includes(tabId) && message.opened !== true) {
          removeMember(group, tabId);
          return { ok: false };
        }
        const names = new Set(
          Object.values(group.members).map((member) => member.name),
        );
        if (names.size >= MAX_TABS) return { ok: false };
        let number = 2;
        while (names.has(`tab${number}`)) number++;
        group.members[tabId] = { name: `tab${number}` };
        group.invited = (group.invited ?? []).filter((id) => id !== tabId);
        joined = true;
      }
      group.members[tabId].documentId = sender.documentId;
      return { ok: true, controller, joined };
    }
    const member = group.members[tabId];
    if (!member || member.documentId !== sender.documentId)
      return { ok: false };
    if (message.op === 'inner-snapshot') {
      const url = String(message.snapshot?.url ?? '');
      member.tab = {
        id: member.name,
        url: url.startsWith(`${group.origin}/`)
          ? url.slice(0, 4096)
          : `${group.origin}/`,
        ...remoteFields(member.name, message.snapshot),
      };
      return { ok: true, controller, changed: true };
    }
    if (message.op === 'inner-gone') {
      delete member.tab;
      delete member.documentId;
      return { ok: true, controller, changed: true };
    }
    return { ok: false };
  });
  if (result.joined) await groupTabs(result.controller, tabId);
  if (result.joined || result.changed) await pushTabs(result.controller);
  return { ok: result.ok };
}

/** A frame (frame1) or tab (tab2) of the page's session, ready for messages. */
async function remoteEntry(tabId, name) {
  if (name.startsWith('tab')) {
    const group = (await tabGroups())[tabId];
    const found = Object.entries(group?.members ?? {}).find(
      ([, member]) => member.name === name,
    );
    return found
      ? {
          name,
          kind: 'tab',
          tabId: Number(found[0]),
          frameId: 0,
          documentId: found[1].documentId,
          origin: group.origin,
        }
      : undefined;
  }
  const entry = await frameEntry(tabId, name);
  return entry ? { ...entry, kind: 'frame', tabId } : undefined;
}
const toRemote = (entry, message) =>
  entry.documentId
    ? chrome.tabs
        .sendMessage(entry.tabId, message, {
          frameId: entry.frameId,
          documentId: entry.documentId,
        })
        .catch(() => undefined)
    : Promise.resolve(undefined);

const TARGET_FIELDS = [
  'tag',
  'name',
  'role',
  'disabled',
  'actionable',
  'href',
  'checked',
  'expanded',
  'selected',
  'required',
  'invalid',
  'filled',
  'inViewport',
  'new',
];
/** A remote document's report, bounded, with target IDs that name it. */
function remoteFields(name, snapshot) {
  const targets = (Array.isArray(snapshot?.targets) ? snapshot.targets : [])
    .filter((target) => FRAME_TARGET.test(String(target?.id)))
    .slice(0, 100)
    .map((target) => {
      const copy = { id: `${name}-${target.id}` };
      for (const field of TARGET_FIELDS)
        if (target[field] !== undefined) copy[field] = target[field];
      return copy;
    });
  return {
    title: String(snapshot?.title ?? '').slice(0, 200),
    text: String(snapshot?.text ?? '').slice(0, 4000),
    targets,
    truncated: {
      text: Boolean(snapshot?.truncated?.text),
      targets: Boolean(snapshot?.truncated?.targets),
    },
  };
}
const frameSnapshot = (entry, snapshot) => ({
  id: entry.name,
  origin: entry.origin,
  ...remoteFields(entry.name, snapshot),
});

/** A frame message is in scope only if the tab's page declared that frame and is granted. */
async function frameScopeOf(sender) {
  const tabId = sender.tab?.id;
  if (
    tabId === undefined ||
    !sender.frameId ||
    !sender.origin ||
    !sender.documentId
  )
    return undefined;
  const top = await tabOrigin(tabId);
  const grant = top ? (await grants())[top] : undefined;
  return grant?.frames?.includes(sender.origin)
    ? { tabId, origin: sender.origin }
    : undefined;
}

async function fromFrame(message, sender) {
  if (sender.frameId === 0) return fromTab(message, sender);
  const scope = await frameScopeOf(sender);
  if (!scope) return { ok: false };
  const { tabId, origin } = scope;
  if (message.op === 'inner-stop') {
    if (sessions.has(tabId)) await stop(tabId, 'escape');
    return { ok: true };
  }
  return queued(
    tabId,
    async () => {
      const state = await frameState(tabId);
      const key = sender.documentId;
      if (message.op === 'inner-hello') {
        if (!state.entries[key]) {
          const names = new Set(
            Object.values(state.entries).map((entry) => entry.name),
          );
          if (names.size >= MAX_FRAMES) return { ok: false };
          let number = 1;
          while (names.has(`frame${number}`)) number++;
          state.entries[key] = {
            name: `frame${number}`,
            origin,
            frameId: sender.frameId,
            documentId: key,
          };
          await saveFrameState(tabId, state);
        }
        return { ok: true };
      }
      if (message.op === 'inner-snapshot' && state.entries[key]) {
        state.entries[key].frame = frameSnapshot(
          state.entries[key],
          message.snapshot,
        );
        await saveFrameState(tabId, state);
        await pushFrames(tabId);
        return { ok: true };
      }
      if (message.op === 'inner-gone') {
        delete state.entries[key];
        await saveFrameState(tabId, state);
        await pushFrames(tabId);
        return { ok: true };
      }
      return { ok: false };
    },
    frameQueues,
  );
}

const ACTIONS = ['click', 'check', 'type', 'press_key'];
async function inspectFrame(tabId, args) {
  if (
    !FRAME_NAME.test(String(args?.frame)) ||
    !FRAME_TARGET.test(String(args?.target)) ||
    !ACTIONS.includes(args?.action)
  )
    return { ok: false, code: 'BAD_REQUEST' };
  if ((await stoppedTabs()).has(tabId))
    return { ok: false, code: 'UNAVAILABLE' };
  const entry = await remoteEntry(tabId, args.frame);
  if (!entry) return { ok: false, code: 'TARGET_MISSING' };
  const reply = await toRemote(entry, {
    frameOp: 'inspect',
    target: args.target,
    action: args.action,
  });
  if (!reply?.ok)
    return { ok: false, code: String(reply?.code ?? 'TARGET_MISSING') };
  const info = reply.info ?? {};
  return {
    ok: true,
    info: {
      risk: ['allow', 'approve', 'deny'].includes(info.risk)
        ? info.risk
        : 'deny',
      label: String(info.label ?? '').slice(0, 120),
      link: info.link === true,
      ...([true, false, 'mixed'].includes(info.checked)
        ? { checked: info.checked }
        : {}),
    },
  };
}

/** Finds the child session whose document holds the frame's nonce. */
async function frameSession(tabId, origin, nonce) {
  for (let waited = 0; waited <= 1500; waited += 50) {
    for (const [sessionId, child] of children.get(tabId) ?? []) {
      let childOrigin;
      try {
        childOrigin = new URL(child.url).origin;
      } catch {
        continue;
      }
      if (child.type !== 'iframe' || childOrigin !== origin) continue;
      try {
        const target = { tabId, sessionId };
        const { root } = await send(target, 'DOM.getDocument', { depth: 0 });
        const { nodeIds } = await send(target, 'DOM.querySelectorAll', {
          nodeId: root.nodeId,
          selector: `[data-pagesquire-target="${nonce}"]`,
        });
        if (nodeIds.length) return sessionId;
      } catch {
        // The frame is navigating or gone.
      }
    }
    // Child sessions attach shortly after the debugger does.
    await sleep(50);
  }
  throw new ActionError('TARGET_MISSING');
}

function frameEffect(effect = {}) {
  return {
    mutations: Math.min(Math.max(Number(effect.mutations) || 0, 0), 1000),
    urlChanged: effect.urlChanged === true,
    focusChanged: effect.focusChanged === true,
    stateChanged: effect.stateChanged === true,
    ...([true, false, 'mixed'].includes(effect.checked)
      ? { checked: effect.checked }
      : {}),
    ...(typeof effect.typed === 'boolean'
      ? {
          typed: effect.typed,
          length: Math.min(Math.max(Number(effect.length) || 0, 0), 100000),
        }
      : {}),
  };
}

/**
 * The frame or tab resolves the signed target and tags it; the worker finds
 * the tag in that document's own session, checks it, and delivers the input.
 */
async function deliverRemote(tabId, origin, args) {
  const entry = await remoteEntry(tabId, args.frame);
  if (!entry) throw new ActionError('TARGET_MISSING');
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const prepared = await toRemote(entry, {
    frameOp: 'prepare',
    target: args.target,
    action: args.kind === 'key' ? 'press_key' : args.kind,
    nonce,
    clear: args.clear === true,
  });
  if (!prepared?.ok) throw new ActionError(prepared?.code ?? 'TARGET_MISSING');
  let finished = false;
  let target;
  let member;
  // Input goes to the top level of the tab that holds the document.
  const inputTab = entry.tabId;
  try {
    if (entry.kind === 'tab') {
      // Another tab gets its own debugger session, same origin and checks.
      member = await attach(inputTab, origin);
      clearTimeout(member.idleTimer);
      target = { tabId: inputTab };
    } else
      target = {
        tabId,
        sessionId: await frameSession(tabId, entry.origin, nonce),
      };
    const located = await locate(target, nonce);
    if (args.kind === 'click') {
      const point = await clickPoint(
        target,
        located,
        target.sessionId
          ? await frameChain(tabId, target.sessionId)
          : undefined,
      );
      if (!(await inScope(inputTab, origin)))
        throw new ActionError('UNAVAILABLE');
      await dispatchClick(inputTab, point);
    } else {
      if (args.kind === 'type' && !located.editable)
        throw new ActionError('TARGET_NOT_ALLOWED');
      await send(target, 'DOM.focus', { nodeId: located.nodeId });
      if (!(await inScope(inputTab, origin)))
        throw new ActionError('UNAVAILABLE');
      if (args.kind === 'type')
        await send({ tabId: inputTab }, 'Input.insertText', {
          text: args.text,
        });
      else await pressKey(inputTab, args.key);
    }
    const done = await toRemote(entry, {
      frameOp: 'finish',
      nonce,
      ...(args.kind === 'type'
        ? { text: args.text, clear: args.clear === true }
        : {}),
    });
    finished = true;
    if (!done?.ok) throw new ActionError(done?.code ?? 'ACTION_FAILED');
    return frameEffect(done.effect);
  } finally {
    if (!finished) toRemote(entry, { frameOp: 'abort', nonce });
    if (target)
      send(target, 'Runtime.releaseObjectGroup', {
        objectGroup: 'pagesquire',
      }).catch(() => {});
    if (member && sessions.get(inputTab) === member) {
      const delay = await idleDetachMs();
      member.idleTimer = setTimeout(() => detach(inputTab), delay);
    }
  }
}

// Screenshots (4D-5): off unless the site declares them and the visitor
// allows them for that site. Form fields, private regions and frames are
// blacked out before the image leaves the extension.
const MAX_SCREENSHOT = 100000;
const REDACT = `(() => {
  const kept = /^(button|submit|reset|image|checkbox|radio|range|color)$/i;
  const selector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-pagesquire-private], iframe, frame, embed, object';
  const rects = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll(selector)) {
      if (element.tagName === 'INPUT' && kept.test(element.type)) continue;
      for (const rect of element.getClientRects())
        if (rect.width > 0 && rect.height > 0)
          rects.push([rect.left, rect.top, rect.width, rect.height]);
    }
    for (const host of root.querySelectorAll('*'))
      if (host.shadowRoot) visit(host.shadowRoot);
  };
  visit(document);
  return rects.slice(0, 5000);
})()`;

/** Boxes to black out, measured in an isolated world page scripts cannot reach. */
async function redactions(tabId) {
  const { frameTree } = await send({ tabId }, 'Page.getFrameTree');
  const { executionContextId } = await send(
    { tabId },
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: 'pagesquire-redact' },
  );
  const { result } = await send({ tabId }, 'Runtime.evaluate', {
    expression: REDACT,
    contextId: executionContextId,
    returnByValue: true,
  });
  return Array.isArray(result.value) ? result.value : [];
}

async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

/** A JPEG of the visible part of the tab with the redactions painted black. */
async function redactedCapture(tabId) {
  // Measure before and after the capture, so a field that moves meanwhile
  // is still covered.
  const before = await redactions(tabId);
  const { cssLayoutViewport: viewport } = await send(
    { tabId },
    'Page.getLayoutMetrics',
  );
  const { data } = await send({ tabId }, 'Page.captureScreenshot', {
    format: 'png',
  });
  const rects = [...before, ...(await redactions(tabId))];
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${data}`)).blob(),
  );
  let width = Math.min(1024, bitmap.width);
  for (let attempt = 0; attempt < 8; attempt++) {
    const height = Math.min(
      2560,
      Math.round((bitmap.height * width) / bitmap.width),
    );
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    context.fillStyle = '#000';
    const scale = width / viewport.clientWidth;
    for (const [x, y, w, h] of rects)
      context.fillRect(
        Math.floor(x * scale) - 1,
        Math.floor(y * scale) - 1,
        Math.ceil(w * scale) + 2,
        Math.ceil(h * scale) + 2,
      );
    const image = await base64(
      await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: Math.max(0.4, 0.7 - attempt * 0.1),
      }),
    );
    if (image.length <= MAX_SCREENSHOT)
      return { mediaType: 'image/jpeg', data: image, width, height };
    if (attempt >= 2) width = Math.round(width * 0.8);
  }
  throw new ActionError('SCREENSHOT_TOO_LARGE');
}

async function captureTab(tabId, origin, tab) {
  const grant = (await grants())[origin];
  if (
    !grant?.manifest.features?.includes('screenshots') ||
    grant.screenshots !== true
  )
    return { ok: false, code: 'SCREENSHOTS_OFF' };
  const target =
    tab === 'tab1' ? tabId : (await remoteEntry(tabId, tab))?.tabId;
  if (target === undefined) return { ok: false, code: 'TAB_MISSING' };
  if (!(await inScope(target, origin)))
    return { ok: false, code: 'UNAVAILABLE' };
  let session;
  try {
    session = await attach(target, origin);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  clearTimeout(session.idleTimer);
  try {
    return { ok: true, screenshot: await redactedCapture(target) };
  } catch (error) {
    return { ok: false, code: error.code ?? 'CDP_ERROR' };
  } finally {
    if (sessions.get(target) === session) {
      const delay = await idleDetachMs();
      session.idleTimer = setTimeout(() => detach(target), delay);
    }
  }
}

/** Shows tab1 (the controller) or a member tab to the visitor. */
async function switchTab(tabId, tab) {
  const target =
    tab === 'tab1' ? tabId : (await remoteEntry(tabId, tab))?.tabId;
  if (target === undefined) return { ok: false, code: 'TAB_MISSING' };
  await chrome.tabs.update(target, { active: true });
  return { ok: true };
}

let usedCalls;
/** Single use per call ID, kept across worker restarts for the session. */
async function useCall(claims) {
  usedCalls ??= chrome.storage.session
    .get('usedCalls')
    .then(({ usedCalls: entries = [] }) => new UsedCalls(entries));
  const used = await usedCalls;
  if (!used.use(claims.callId, claims.exp)) return false;
  await chrome.storage.session.set({ usedCalls: used.toJSON() });
  return true;
}

const refreshed = new Map();
/** After a failed signature, re-read the declaration once a minute in case the key rotated. */
async function refreshKey(origin) {
  if (Date.now() - (refreshed.get(origin) ?? 0) < 60000) return undefined;
  refreshed.set(origin, Date.now());
  const all = await grants();
  const manifest = await fetchManifest(origin);
  if (
    !all[origin] ||
    !manifest.valid ||
    manifest.value.publicKey === all[origin].manifest.publicKey
  )
    return undefined;
  // Only the key changes; frames stay as the visitor allowed them.
  all[origin] = {
    ...all[origin],
    manifest: { ...all[origin].manifest, publicKey: manifest.value.publicKey },
  };
  await chrome.storage.local.set({ grants: all });
  return manifest.value.publicKey;
}

/** Invariant 3: only calls the site's server signed, for this input, once. */
async function signed(origin, args) {
  const grant = (await grants())[origin];
  const check = (publicKey) =>
    verifySignedAction({ signature: args.signature, publicKey, origin, args });
  let result = await check(grant?.manifest.publicKey);
  if (result.code === 'BAD_SIGNATURE') {
    const rotated = await refreshKey(origin);
    if (rotated) result = await check(rotated);
  }
  if (result.code) return result.code;
  return (await useCall(result.claims)) ? undefined : 'REPLAYED';
}

async function act(tabId, origin, args) {
  const invalid = invalidAction(args);
  if (invalid) return { ok: false, code: invalid };
  const refused = await signed(origin, args);
  if (refused) {
    await audit({
      origin,
      kind: args.kind,
      key: args.key,
      ok: false,
      code: refused,
    });
    return { ok: false, code: refused };
  }
  if ((await stoppedTabs()).has(tabId))
    return { ok: false, code: 'UNAVAILABLE' };
  if (!limiter.allow(tabId)) return { ok: false, code: 'RATE_LIMITED' };
  if (args.kind === 'screenshot') {
    const shot = await captureTab(tabId, origin, args.tab);
    await audit({ origin, kind: 'screenshot', ok: shot.ok, code: shot.code });
    return shot;
  }
  if (args.kind === 'switch') {
    const switched = await switchTab(tabId, args.tab);
    await audit({
      origin,
      kind: 'switch',
      ok: switched.ok,
      code: switched.code,
    });
    return switched;
  }
  // Inputs for another tab attach to that tab only.
  const remoteTab = args.frame?.startsWith('tab');
  let session;
  if (!remoteTab) {
    try {
      session = await attach(tabId, origin);
    } catch {
      // For example DevTools already attached: the page uses its own input.
      await detach(tabId);
      return { ok: false, code: 'UNAVAILABLE' };
    }
    if (session.origin !== origin || !(await inScope(tabId, origin))) {
      await detach(tabId);
      return { ok: false, code: 'UNAVAILABLE' };
    }
    clearTimeout(session.idleTimer);
  } else if (!(await inScope(tabId, origin)))
    return { ok: false, code: 'UNAVAILABLE' };
  let result;
  try {
    if (args.frame !== undefined)
      result = { ok: true, effect: await deliverRemote(tabId, origin, args) };
    else {
      await deliver(tabId, origin, args);
      result = { ok: true };
    }
  } catch (error) {
    if ((await stoppedTabs()).has(tabId))
      result = { ok: false, code: 'STOPPED' };
    else result = { ok: false, code: error.code ?? 'CDP_ERROR' };
  } finally {
    send({ tabId }, 'Runtime.releaseObjectGroup', {
      objectGroup: 'pagesquire',
    }).catch(() => {});
  }
  if (session && sessions.get(tabId) === session) {
    const delay = await idleDetachMs();
    session.idleTimer = setTimeout(() => detach(tabId), delay);
  }
  await audit({
    origin,
    kind:
      args.frame === undefined
        ? args.kind
        : `${args.kind} in ${remoteTab ? 'tab' : 'frame'}`,
    key: args.key,
    ok: result.ok,
    code: result.code,
  });
  return result;
}

/** One task at a time per tab, whatever the page or its frames send. */
function queued(tabId, task, map = queues) {
  const next = (map.get(tabId) ?? Promise.resolve()).then(task, task);
  map.set(
    tabId,
    next.catch(() => {}),
  );
  return next;
}

async function fromPage(message, sender) {
  const tabId = sender.tab?.id;
  const origin = sender.origin;
  if (
    tabId === undefined ||
    sender.frameId !== 0 ||
    !origin ||
    !isTestOrigin(origin) ||
    !(await grants())[origin]
  )
    return { ok: false, code: 'UNAVAILABLE' };
  if (message.op === 'hello') {
    // A page with the chat controls its session; tabs it opens may join.
    await withTabs((groups) => {
      groups[tabId] ??= { origin, members: {}, invited: [] };
      Object.assign(groups[tabId], { origin, seen: Date.now() });
    });
    return { ok: true, version: PROTOCOL, features: FEATURES };
  }
  if (message.op === 'frames')
    return { ok: true, frames: await framesFor(tabId) };
  if (message.op === 'tabs') return { ok: true, tabs: await tabsFor(tabId) };
  if (message.op === 'frame-inspect') return inspectFrame(tabId, message.args);
  if (message.op === 'act')
    return queued(tabId, () => act(tabId, origin, message.args));
  // A trusted Escape stops only while the assistant is acting, here or in
  // the session this tab joined.
  if (message.op === 'stop') {
    const [controller] = groupOf(await tabGroups(), tabId);
    const owner = controller ?? tabId;
    if (sessions.has(tabId) || sessions.has(owner)) await stop(owner, 'escape');
    return { ok: true };
  }
  return { ok: false, code: 'BAD_REQUEST' };
}

async function tabOrigin(tabId) {
  const tab = await chrome.tabs.get(tabId);
  // Without host access to the tab, Chrome leaves url undefined.
  try {
    const origin = tab.url ? new URL(tab.url).origin : undefined;
    return origin && isTestOrigin(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
}

async function fromPanel(message) {
  const tabId = message.tabId;
  switch (message.op) {
    case 'state': {
      const origin = Number.isInteger(tabId)
        ? await tabOrigin(tabId)
        : undefined;
      const grant = origin ? (await grants())[origin] : undefined;
      const { audit: log = [] } = await chrome.storage.session.get('audit');
      const groups = await tabGroups();
      const [controller, group] = groupOf(groups, tabId);
      const member = group?.members[tabId];
      return {
        origin,
        grant,
        ...(member ? { member: member.name } : {}),
        sharedTabs: Object.values(groups[tabId]?.members ?? {}).map((entry) =>
          `${entry.name} ${entry.tab?.url ?? ''}`.trim(),
        ),
        shareable:
          Boolean(grant) &&
          controller === undefined &&
          Object.entries(groups).some(
            ([id, entry]) => Number(id) !== tabId && entry.origin === origin,
          ),
        acting: sessions.has(tabId),
        stopped: (await stoppedTabs()).has(tabId),
        audit: log.slice(-20).reverse(),
      };
    }
    case 'inspect': {
      const origin = await tabOrigin(tabId);
      if (!origin) return { valid: false, errors: [] };
      const manifest = await fetchManifest(origin);
      return manifest.valid
        ? { ...manifest, frames: frameScope(manifest.value.frames, origin) }
        : manifest;
    }
    case 'grant': {
      const origin = await tabOrigin(tabId);
      if (!origin) return { ok: false };
      const manifest = await fetchManifest(origin);
      if (!manifest.valid) return { ok: false, errors: manifest.errors };
      const all = await grants();
      all[origin] = {
        origin,
        grantedAt: Date.now(),
        manifest: manifest.value,
        // The visitor allows exactly the frames shown, minus denied ones.
        frames: frameScope(manifest.value.frames, origin).allowed,
        // Screenshots stay off until the visitor turns them on.
        screenshots: false,
      };
      await chrome.storage.local.set({ grants: all });
      await syncContentScripts();
      // Reach the open page and its frames now instead of after a reload.
      await chrome.scripting
        .executeScript({ target: { tabId }, files: ['src/content.js'] })
        .catch(() => {});
      if (all[origin].frames.length)
        await chrome.scripting
          .executeScript({
            target: { tabId, allFrames: true },
            files: ['dist/remote.js'],
          })
          .catch(() => {});
      await audit({ origin, kind: 'grant', ok: true });
      return { ok: true };
    }
    case 'revoke': {
      const all = await grants();
      const origin = message.origin;
      delete all[origin];
      await chrome.storage.local.set({ grants: all });
      await syncContentScripts();
      for (const [id, session] of sessions)
        if (session.origin === origin) await detach(id);
      await audit({ origin, kind: 'revoke', ok: true });
      return { ok: true };
    }
    case 'screenshots': {
      const all = await grants();
      const grant = all[message.origin];
      if (!grant?.manifest.features?.includes('screenshots'))
        return { ok: false };
      grant.screenshots = message.enabled === true;
      await chrome.storage.local.set({ grants: all });
      await audit({
        origin: message.origin,
        kind: grant.screenshots ? 'screenshots on' : 'screenshots off',
        ok: true,
      });
      return { ok: true };
    }
    case 'stop':
      await stop(tabId, 'panel');
      return { ok: true };
    case 'resume':
      await setStopped(tabId, false);
      await pushFrames(tabId);
      await pushTabs(tabId);
      return { ok: true };
    case 'share': {
      // The visitor adds this tab to the session of a page with the same
      // origin, the one that talked to the extension last.
      const origin = await tabOrigin(tabId);
      if (!origin || !(await grants())[origin]) return { ok: false };
      const shared = await withTabs((groups) => {
        if (groupOf(groups, tabId)[1]) return false;
        const [, group] =
          Object.entries(groups)
            .filter(
              ([id, entry]) => Number(id) !== tabId && entry.origin === origin,
            )
            .sort((a, b) => (b[1].seen ?? 0) - (a[1].seen ?? 0))[0] ?? [];
        if (!group || groupSize(group) >= MAX_TABS) return false;
        (group.invited ??= []).push(tabId);
        return true;
      });
      if (!shared) return { ok: false };
      // A remote script already running here (shared before) says hello
      // again; otherwise inject one.
      const rejoined = await chrome.tabs
        .sendMessage(tabId, { frameOp: 'rejoin' }, { frameId: 0 })
        .catch(() => undefined);
      if (!rejoined?.ok)
        await chrome.scripting
          .executeScript({ target: { tabId }, files: ['dist/remote.js'] })
          .catch(() => {});
      return { ok: true };
    }
    case 'unshare': {
      const controller = await withTabs((groups) => {
        const [owner, group] = groupOf(groups, tabId);
        if (group) removeMember(group, tabId);
        return owner;
      });
      if (controller !== undefined) {
        await detach(tabId);
        await pushTabs(controller);
      }
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler =
    sender.id !== chrome.runtime.id
      ? async () => ({ ok: false })
      : sender.url?.startsWith(chrome.runtime.getURL(''))
        ? () => fromPanel(message)
        : String(message?.op).startsWith('inner-')
          ? () => fromFrame(message, sender)
          : () => fromPage(message, sender);
  handler().then(reply, () => reply({ ok: false, code: 'ERROR' }));
  return true;
});

// Remember which tab opened which: a tab opened from a session tab joins
// once its page loads on the same origin and confirms it was opened.
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId === undefined) return;
  withTabs(async () => {
    const { tabOpeners = {} } = await chrome.storage.session.get('tabOpeners');
    tabOpeners[tab.id] = tab.openerTabId;
    await chrome.storage.session.set({ tabOpeners });
  });
});
// A member that navigates away from the session's origin leaves it.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== 'complete') return;
  const [controller, group] = groupOf(await tabGroups(), tabId);
  if (!group || (await tabOrigin(tabId)) === group.origin) return;
  await withTabs((groups) => {
    const [, current] = groupOf(groups, tabId);
    if (current) removeMember(current, tabId);
  });
  await detach(tabId);
  await pushTabs(controller);
});
// Which tab the visitor looks at is part of what tabs report.
chrome.tabs.onActivated.addListener(async () => {
  for (const [controller, group] of Object.entries(await tabGroups()))
    if (Object.keys(group.members).length) await pushTabs(Number(controller));
});

chrome.runtime.onInstalled.addListener(() => {
  syncContentScripts();
});
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
