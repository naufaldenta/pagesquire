import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { ActionCall, JsonObject } from '@pagesquire/protocol';
import { fail } from './engine.js';

/** Prefix of every signed message, so a key cannot be reused for other data. */
export const SIGNATURE_CONTEXT = 'pagesquire-call-v1.';
/** Lifetime of a signed call. The extension also accepts each call only once. */
export const SIGNATURE_TTL_SECONDS = 60;

export interface ActionSigning {
  /** Base64 of a 32-byte Ed25519 seed; keep it secret, like an API key. */
  key: string;
  /** The site origin the calls are for, e.g. https://shop.example. */
  origin: string;
}

/** What the server signs; the extension checks every field. */
export interface SignatureClaims {
  v: 1;
  origin: string;
  callId: string;
  capabilityId: string;
  snapshotId: string;
  parameters: JsonObject;
  /** Issued and expiry times, in Unix seconds. */
  iat: number;
  exp: number;
}

// PKCS#8 wrapping of a raw Ed25519 seed (RFC 8410).
const SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function seed(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== key)
    fail(
      'INVALID_OPTIONS',
      'The signing key must be base64 of a 32-byte Ed25519 seed.',
      500,
    );
  return bytes;
}

function privateKey(key: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([SEED_PREFIX, seed(key)]),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawPublicKey(key: KeyObject): Buffer {
  return Buffer.from(
    createPublicKey(key).export({ format: 'jwk' }).x!,
    'base64url',
  );
}

/** A new signing key and the public key to publish in the site declaration. */
export function createSigningKey(): { signingKey: string; publicKey: string } {
  const { privateKey: key } = generateKeyPairSync('ed25519');
  const signingKey = Buffer.from(
    key.export({ format: 'jwk' }).d!,
    'base64url',
  ).toString('base64');
  return { signingKey, publicKey: signingPublicKey(signingKey) };
}

/** The `ed25519:…` public key for a signing key. */
export function signingPublicKey(signingKey: string): string {
  return `ed25519:${rawPublicKey(privateKey(signingKey)).toString('base64')}`;
}

/** Checks signing options once, at engine construction. */
export function checkSigning(signing: ActionSigning): void {
  privateKey(signing.key);
  let origin: string | undefined;
  try {
    origin = new URL(signing.origin).origin;
  } catch {
    origin = undefined;
  }
  if (origin !== signing.origin || !/^https?:/.test(signing.origin))
    fail(
      'INVALID_OPTIONS',
      'The signing origin must be an http(s) origin such as https://shop.example.',
      500,
    );
}

/** Returns the call with a signature over its claims. */
export function signActionCall(
  call: ActionCall,
  signing: ActionSigning,
  now = Date.now(),
): ActionCall {
  const iat = Math.floor(now / 1000);
  const claims: SignatureClaims = {
    v: 1,
    origin: signing.origin,
    callId: call.callId,
    capabilityId: call.capabilityId,
    snapshotId: call.snapshotId,
    parameters: call.parameters,
    iat,
    exp: iat + SIGNATURE_TTL_SECONDS,
  };
  const text = JSON.stringify(claims);
  const value = sign(
    null,
    Buffer.from(SIGNATURE_CONTEXT + text),
    privateKey(signing.key),
  ).toString('base64');
  return { ...call, signature: { claims: text, value } };
}

/**
 * The claims of a correctly signed call for `origin`, or undefined. Mirrors
 * the extension's signature check (single use is the extension's job).
 */
export function verifyActionCall(
  call: ActionCall,
  publicKey: string,
  origin: string,
  now = Date.now(),
): SignatureClaims | undefined {
  const match = /^ed25519:([A-Za-z0-9+/]{43}=)$/.exec(publicKey);
  if (!match || !call.signature) return undefined;
  const key = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(match[1]!, 'base64').toString('base64url'),
    },
    format: 'jwk',
  });
  if (
    !verify(
      null,
      Buffer.from(SIGNATURE_CONTEXT + call.signature.claims),
      key,
      Buffer.from(call.signature.value, 'base64'),
    )
  )
    return undefined;
  let claims: SignatureClaims;
  try {
    claims = JSON.parse(call.signature.claims) as SignatureClaims;
  } catch {
    return undefined;
  }
  const seconds = now / 1000;
  return claims.v === 1 &&
    claims.origin === origin &&
    claims.callId === call.callId &&
    claims.capabilityId === call.capabilityId &&
    claims.snapshotId === call.snapshotId &&
    JSON.stringify(claims.parameters) === JSON.stringify(call.parameters) &&
    claims.iat <= seconds + 120 &&
    seconds <= claims.exp + 120
    ? claims
    : undefined;
}

/** The `/.well-known/pagesquire.json` document for the companion extension. */
export function siteDeclaration(options: {
  endpoint: string;
  signingKey: string;
  /** Declare redacted screenshots (the visitor still has to allow them). */
  screenshots?: boolean;
}): { version: 1; endpoint: string; publicKey: string; features: string[] } {
  return {
    version: 1,
    endpoint: options.endpoint,
    publicKey: signingPublicKey(options.signingKey),
    features: options.screenshots
      ? ['trustedInput', 'screenshots']
      : ['trustedInput'],
  };
}
