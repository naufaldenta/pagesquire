import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  EMOTIONS,
  PROTOCOL_VERSION,
  normalizeEmotion,
  validateActionCall,
  validateActionResult,
  validateAssistantResponse,
  validateManifest,
} from '@pagesquire/protocol';
import { manifest } from '../fixtures/capabilities.mjs';

const action = {
  protocolVersion: PROTOCOL_VERSION,
  callId: 'request-1',
  capabilityId: 'accessibility.set_heading_color',
  snapshotId: 'snapshot-1',
  parameters: { color: '#ff0000' },
};

test('the canonical manifest and a versioned action call validate', () => {
  assert.equal(validateManifest(manifest).valid, true);
  assert.equal(validateActionCall(action).valid, true);
});

test('action calls reject unsupported versions, missing IDs, and extra instructions', () => {
  for (const value of [
    { ...action, protocolVersion: '2.0' },
    { ...action, snapshotId: '' },
    { ...action, callId: undefined },
    { ...action, executeJavaScript: 'alert(1)' },
    { ...action, capabilityId: 'arbitrary script' },
  ])
    assert.equal(validateActionCall(value).valid, false);
});

test('manifests require closed parameter objects and explicit verification', () => {
  const original = manifest.capabilities[0];
  for (const capability of [
    { ...original, verification: undefined },
    {
      ...original,
      inputSchema: { type: 'object', additionalProperties: true },
    },
    { ...original, execution: 'shell' },
  ])
    assert.equal(
      validateManifest({ schemaVersion: '0.1', capabilities: [capability] })
        .valid,
      false,
    );
});

test('responses require a supported emotion and structured tool calls', () => {
  const response = {
    protocolVersion: '0.1',
    text: 'Working on it.',
    emotion: 'thinking',
    finished: false,
    toolCalls: [action],
  };
  assert.equal(validateAssistantResponse(response).valid, true);
  assert.equal(
    validateAssistantResponse({ ...response, emotion: 'unknown' }).valid,
    false,
  );
  assert.equal(
    validateAssistantResponse({ ...response, toolCalls: ['click anything'] })
      .valid,
    false,
  );
  assert.equal(
    validateAssistantResponse({ ...response, emotion: undefined }).valid,
    false,
  );
});

test('emotion normalization accepts all six declared states and uses a fallback', () => {
  for (const emotion of EMOTIONS)
    assert.equal(normalizeEmotion(emotion), emotion);
  assert.equal(normalizeEmotion('unknown'), 'idle');
  assert.equal(normalizeEmotion(null, 'sad'), 'sad');
});

test('action results distinguish verified, unverified, failed, and cancelled states', () => {
  const result = {
    protocolVersion: '0.1',
    callId: 'request-1',
    capabilityId: 'browser.navigate',
    status: 'unverified',
    code: 'NAVIGATION_PENDING',
    message: 'Waiting for navigation.',
    evidence: {},
  };
  assert.equal(validateActionResult(result).valid, true);
  assert.equal(
    validateActionResult({ ...result, status: 'probably_done' }).valid,
    false,
  );
  assert.equal(validateActionResult({ ...result, evidence: [] }).valid, false);
});

test('published schemas are exported as JSON artifacts', async () => {
  for (const name of [
    'capability',
    'manifest',
    'actionCall',
    'response',
    'snapshot',
    'actionResult',
    'chatRequest',
    'chatReply',
    'providerResponse',
  ]) {
    const schema = JSON.parse(
      await readFile(
        new URL(
          `../../packages/protocol/dist/schemas/${name}.json`,
          import.meta.url,
        ),
      ),
    );
    assert.equal(
      schema.$schema,
      'https://json-schema.org/draft/2020-12/schema',
    );
    assert.match(schema.$id, /^urn:pagesquire:/);
  }
});
