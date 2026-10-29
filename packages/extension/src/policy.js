// Pure policy for the companion extension: which sites qualify, what a site
// manifest may declare, and which targets and keys are never driven. The
// service worker applies these; unit tests run them in Node.

export const PROTOCOL = 1;
export const FEATURES = ['trustedInput'];
// "link" is a server-to-server feature (PageSquire Link); the extension accepts and ignores it.
export const KNOWN_FEATURES = [
  'trustedInput',
  'frames',
  'tabs',
  'screenshots',
  'link',
];
export const MAX_MANIFEST_BYTES = 16384;
export const ACTIONS_PER_MINUTE = 60;
export const IDLE_DETACH_MS = 30000;

/**
 * Development builds act only on local and `.test` sites until signed action
 * calls (Phase 4D-2) exist. Keep in sync with manifest host_permissions.
 */
export function isTestOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.test')
  );
}

/** The content-script match pattern for an origin (patterns carry no port). */
export function originPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Validates `/.well-known/pagesquire.json`. Version 1 is strict: unknown
 * fields are rejected so a site cannot rely on something this build ignores.
 */
export function validateSiteManifest(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { valid: false, errors: ['The manifest must be a JSON object.'] };
  const allowed = new Set([
    'version',
    'endpoint',
    'publicKey',
    'frames',
    'features',
    'link',
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push(`Unknown field "${key}".`);
  if (value.version !== 1) errors.push('"version" must be 1.');
  if (
    typeof value.endpoint !== 'string' ||
    !value.endpoint.startsWith('/') ||
    value.endpoint.startsWith('//') ||
    value.endpoint.length > 200
  )
    errors.push('"endpoint" must be a same-origin path such as /api/chat.');
  // Every action call must be signed (Phase 4D-2), so the key is required.
  if (
    typeof value.publicKey !== 'string' ||
    !/^ed25519:[A-Za-z0-9+/]{43}=$/.test(value.publicKey)
  )
    errors.push(
      '"publicKey" is required: "ed25519:" and a base64 32-byte key (npx pagesquire signing-key).',
    );
  if (value.frames !== undefined) {
    if (!Array.isArray(value.frames) || value.frames.length > 10)
      errors.push('"frames" must list at most 10 origins.');
    else
      for (const frame of value.frames) {
        let origin;
        try {
          origin = new URL(frame).origin;
        } catch {
          origin = undefined;
        }
        if (origin !== frame || !/^https?:/.test(frame))
          errors.push(`"frames" entry "${String(frame)}" is not an origin.`);
      }
  }
  if (
    value.link !== undefined &&
    (!value.link || typeof value.link !== 'object' || Array.isArray(value.link))
  )
    errors.push('"link" must be an object.');
  const features = value.features ?? ['trustedInput'];
  if (
    !Array.isArray(features) ||
    !features.length ||
    new Set(features).size !== features.length ||
    features.some((feature) => !KNOWN_FEATURES.includes(feature))
  )
    errors.push(
      `"features" must be distinct values of ${KNOWN_FEATURES.join(', ')}.`,
    );
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      version: 1,
      endpoint: value.endpoint,
      publicKey: value.publicKey,
      frames: value.frames ?? [],
      features,
    },
  };
}

/** Why a target is reserved for the visitor, judged from CDP's node data. */
export function sensitiveReason(nodeName, attributes) {
  const map = {};
  for (let i = 0; i + 1 < (attributes ?? []).length; i += 2)
    map[String(attributes[i]).toLowerCase()] = String(attributes[i + 1]);
  const type = (map.type ?? '').toLowerCase();
  const autocomplete = (map.autocomplete ?? '').toLowerCase();
  if (nodeName === 'INPUT' && ['password', 'file', 'hidden'].includes(type))
    return `${type} input`;
  if (
    /\b(?:one-time-code|current-password|new-password|cc-[a-z-]+)\b/.test(
      autocomplete,
    )
  )
    return `${autocomplete} field`;
  if ('data-pagesquire-private' in map) return 'private region';
  return undefined;
}

/**
 * Keys the extension sends as trusted input. Escape is deliberately absent:
 * a trusted Escape is always the visitor's stop key.
 */
export const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
};

/** A remote document: a granted frame (frame1) or another session tab (tab2). */
export const FRAME_NAME = /^(?:frame[1-9][0-9]{0,2}|tab[2-9])$/;
export const TAB_NAME = /^tab[1-9]$/;
export const MAX_TABS = 4;
export const FRAME_TARGET = /^target-[A-Za-z0-9_-]{1,100}$/;
export const MAX_FRAMES = 5;

/**
 * Payment, identity and banking providers. Their frames are never read or
 * driven, even when a site declares them and the visitor allows the site.
 */
export const DENIED_FRAME_HOSTS = [
  'stripe.com',
  'stripe.network',
  'paypal.com',
  'paypalobjects.com',
  'braintreegateway.com',
  'adyen.com',
  'checkout.com',
  'squareup.com',
  'klarna.com',
  'midtrans.com',
  'xendit.co',
  'doku.com',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'okta.com',
  'auth0.com',
  'facebook.com',
];

export function deniedFrame(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return true;
  }
  return DENIED_FRAME_HOSTS.some(
    (denied) => host === denied || host.endsWith(`.${denied}`),
  );
}

/**
 * Splits declared frame origins into those this build may read and act in
 * (local or `.test`, not denied, not the page itself) and the rest.
 */
export function frameScope(frames, pageOrigin) {
  const allowed = [];
  const refused = [];
  for (const frame of frames ?? [])
    (isTestOrigin(frame) && !deniedFrame(frame) && frame !== pageOrigin
      ? allowed
      : refused
    ).push(frame);
  return { allowed, refused };
}

/** Validates one action request from the page; returns an error code or undefined. */
export function invalidAction(args) {
  if (!args || typeof args !== 'object') return 'BAD_REQUEST';
  if (args.kind === 'switch' || args.kind === 'screenshot')
    return typeof args.tab === 'string' &&
      TAB_NAME.test(args.tab) &&
      args.nonce === undefined &&
      args.frame === undefined
      ? undefined
      : 'BAD_REQUEST';
  // Page targets carry the page's nonce; frame targets name the frame and
  // its target ID, which the frame itself resolves.
  if (args.frame !== undefined) {
    if (
      typeof args.frame !== 'string' ||
      !FRAME_NAME.test(args.frame) ||
      typeof args.target !== 'string' ||
      !FRAME_TARGET.test(args.target) ||
      args.nonce !== undefined ||
      (args.clear !== undefined && typeof args.clear !== 'boolean')
    )
      return 'BAD_REQUEST';
  } else if (
    typeof args.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(args.nonce)
  )
    return 'BAD_REQUEST';
  if (args.kind === 'click') return undefined;
  if (args.kind === 'type')
    return typeof args.text === 'string' &&
      args.text.length > 0 &&
      args.text.length <= 10000
      ? undefined
      : 'BAD_REQUEST';
  if (args.kind === 'key')
    return Object.hasOwn(KEYS, args.key) ? undefined : 'BAD_REQUEST';
  return 'BAD_REQUEST';
}

export const SIGNATURE_CONTEXT = 'pagesquire-call-v1.';
/** Tolerated clock difference between the visitor and the site, in seconds. */
export const CLOCK_SKEW_SECONDS = 120;
/** Which input each signed capability may become. */
export const SIGNED_KINDS = {
  'ui.click': 'click',
  'ui.check': 'click',
  'ui.type': 'type',
  'ui.press_key': 'key',
  'ui.switch_tab': 'switch',
  'ui.screenshot': 'screenshot',
};

const fromBase64 = (text) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * Checks the server's signature on an action and that the requested input is
 * what was signed. Returns `{ claims }` or `{ code }`. Single use is checked
 * by the caller with `claims.callId`.
 */
export async function verifySignedAction({
  signature,
  publicKey,
  origin,
  args,
  now = Date.now(),
}) {
  if (
    !signature ||
    typeof signature.claims !== 'string' ||
    signature.claims.length > 16384 ||
    typeof signature.value !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)
  )
    return { code: 'UNSIGNED' };
  const key = /^ed25519:([A-Za-z0-9+/]{43}=)$/.exec(publicKey ?? '');
  if (!key) return { code: 'BAD_SIGNATURE' };
  let valid = false;
  try {
    const imported = await crypto.subtle.importKey(
      'raw',
      fromBase64(key[1]),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      imported,
      fromBase64(signature.value),
      new TextEncoder().encode(SIGNATURE_CONTEXT + signature.claims),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { code: 'BAD_SIGNATURE' };
  let claims;
  try {
    claims = JSON.parse(signature.claims);
  } catch {
    return { code: 'BAD_SIGNATURE' };
  }
  const seconds = now / 1000;
  if (
    !claims ||
    claims.v !== 1 ||
    claims.origin !== origin ||
    typeof claims.callId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(claims.callId) ||
    !claims.parameters ||
    typeof claims.parameters !== 'object'
  )
    return { code: 'MISMATCH' };
  if (
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.exp < claims.iat ||
    claims.exp - claims.iat > 300 ||
    claims.iat > seconds + CLOCK_SKEW_SECONDS ||
    seconds > claims.exp + CLOCK_SKEW_SECONDS
  )
    return { code: 'EXPIRED' };
  const kind = SIGNED_KINDS[claims.capabilityId];
  // In frames the extension resolves the target itself, so the signed
  // target ID binds which element receives the input.
  const signedTarget = String(claims.parameters.target ?? '');
  if (
    args.frame !== undefined
      ? signedTarget !== `${args.frame}-${args.target}` ||
        (kind === 'type' &&
          (claims.parameters.clear === true) !== (args.clear === true))
      : /^(?:frame[1-9][0-9]{0,2}|tab[2-9])-/.test(signedTarget)
  )
    return { code: 'MISMATCH' };
  if (
    kind !== args.kind ||
    (kind === 'type' && claims.parameters.text !== args.text) ||
    (kind === 'key' && claims.parameters.key !== args.key) ||
    ((kind === 'switch' || kind === 'screenshot') &&
      claims.parameters.tab !== args.tab)
  )
    return { code: 'MISMATCH' };
  return { claims };
}

/** Remembers used call IDs until they could no longer verify anyway. */
export class UsedCalls {
  constructor(entries = []) {
    this.entries = new Map(entries);
  }

  /** False when `callId` was already used; records it otherwise. */
  use(callId, exp, now = Date.now()) {
    const seconds = now / 1000;
    for (const [id, expiry] of this.entries)
      if (expiry + CLOCK_SKEW_SECONDS < seconds) this.entries.delete(id);
    if (this.entries.has(callId)) return false;
    this.entries.set(callId, exp);
    return true;
  }

  toJSON() {
    return [...this.entries];
  }
}

/** A sliding one-minute window per key. */
export class RateLimiter {
  constructor(limit = ACTIONS_PER_MINUTE, windowMs = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter(
      (time) => now - time < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  forget(key) {
    this.hits.delete(key);
  }
}

/** Audit entries keep where and what kind of input ran, never text or targets. */
export function auditEntry({ origin, kind, key, ok, code, at = Date.now() }) {
  return {
    at,
    origin,
    kind,
    ...(kind === 'key' ? { key } : {}),
    ok: Boolean(ok),
    ...(code ? { code } : {}),
  };
}
