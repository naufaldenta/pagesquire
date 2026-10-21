import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

export class EvaluationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new EvaluationError(code);
};
const id = (value) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,95}$/.test(value);
const keys = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');

/** Owner-controlled offline campaign ledger, not a production billing/currency cap. */
export async function openEvaluationBudget({
  root,
  campaign,
  maximum,
  fingerprint,
}) {
  if (
    !id(campaign) ||
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > 1000 ||
    !/^[a-f0-9]{64}$/.test(fingerprint)
  )
    fail('INVALID_EVALUATION_OPTIONS');
  let directory = await realpath(root);
  for (const segment of ['.cache', 'model-evaluation', campaign]) {
    directory = path.join(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      fail('UNSAFE_EVALUATION_PATH');
  }
  const filename = path.join(directory, 'budget.json');
  const lockname = path.join(directory, 'campaign.lock');
  const token = randomUUID();
  let lock;
  try {
    lock = await open(lockname, 'wx', 0o600);
  } catch {
    fail('EVALUATION_LOCKED');
  }
  await lock.writeFile(token);
  await lock.sync();
  let closed = false;
  let closing = false;
  let closePromise;
  async function close() {
    if (closed) return;
    if (closing) return closePromise;
    closing = true;
    closePromise = (async () => {
      await queue;
      closed = true;
      await lock.close();
      if ((await readFile(lockname, 'utf8')) === token) await unlink(lockname);
    })();
    return closePromise;
  }
  let state;
  let queue = Promise.resolve();
  const mutate = (operation) => {
    if (closing || closed)
      return Promise.reject(new EvaluationError('EVALUATION_CLOSED'));
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  async function save() {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(state, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, filename);
  }
  try {
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576)
        fail('UNSAFE_EVALUATION_LEDGER');
      state = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = {
        schemaVersion: 1,
        maximum,
        fingerprint,
        attempts: [],
        results: [],
      };
    }
    if (
      !keys(state, [
        'schemaVersion',
        'maximum',
        'fingerprint',
        'attempts',
        'results',
      ]) ||
      state.schemaVersion !== 1 ||
      state.maximum !== maximum ||
      state.fingerprint !== fingerprint ||
      !Array.isArray(state.attempts) ||
      state.attempts.length > maximum ||
      !state.attempts.every(
        (entry) =>
          keys(entry, ['caseId', 'turn']) &&
          id(entry.caseId) &&
          Number.isInteger(entry.turn) &&
          entry.turn >= 0 &&
          entry.turn < 40,
      ) ||
      !Array.isArray(state.results) ||
      state.results.length > 1000 ||
      !state.results.every(
        (entry) =>
          keys(entry, ['caseId', 'code', 'passedTurns', 'totalTurns']) &&
          id(entry.caseId) &&
          /^[A-Z_]{1,60}$/.test(entry.code) &&
          Number.isInteger(entry.passedTurns) &&
          entry.passedTurns >= 0 &&
          Number.isInteger(entry.totalTurns) &&
          entry.totalTurns >= entry.passedTurns,
      ) ||
      new Set(state.results.map((entry) => entry.caseId)).size !==
        state.results.length
    )
      fail('EVALUATION_LEDGER_MISMATCH');
    await save();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    get used() {
      return state.attempts.length;
    },
    get remaining() {
      return maximum - state.attempts.length;
    },
    get results() {
      return structuredClone(state.results);
    },
    started: (caseId) =>
      state.attempts.some((entry) => entry.caseId === caseId) ||
      state.results.some((entry) => entry.caseId === caseId),
    reserve(caseId, turn) {
      return mutate(async () => {
        if (
          closed ||
          !id(caseId) ||
          !Number.isInteger(turn) ||
          turn < 0 ||
          turn >= 40
        )
          fail('INVALID_EVALUATION_RESERVATION');
        if (state.attempts.length >= maximum)
          fail('EVALUATION_BUDGET_EXHAUSTED');
        state.attempts.push({ caseId, turn });
        await save();
      });
    },
    finish({ caseId, code, passedTurns, totalTurns }) {
      return mutate(async () => {
        if (
          closed ||
          !id(caseId) ||
          !/^[A-Z_]{1,60}$/.test(code) ||
          !Number.isInteger(passedTurns) ||
          passedTurns < 0 ||
          !Number.isInteger(totalTurns) ||
          totalTurns < passedTurns ||
          state.results.some((entry) => entry.caseId === caseId)
        )
          fail('INVALID_EVALUATION_RESULT');
        state.results.push({ caseId, code, passedTurns, totalTurns });
        await save();
      });
    },
    close,
  };
}
