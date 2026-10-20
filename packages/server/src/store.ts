import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fail, encode } from './engine.js';
import type { ConversationState } from './engine.js';

export interface StoredSession {
  principal: string;
  state: ConversationState | null;
  rate: { since: number; count: number };
}
export interface StateTransaction {
  load(): Promise<StoredSession | null>;
  save(value: StoredSession): Promise<void>;
}
/** The host must provide exclusive serialization and durable writes before save resolves. */
export interface ConversationStore {
  transaction<T>(
    key: string,
    operation: (transaction: StateTransaction) => Promise<T>,
  ): Promise<T>;
}

/** Single-host durable storage, not a distributed/serverless locking service. */
export class FileConversationStore implements ConversationStore {
  constructor(private readonly directory: string) {}
  async transaction<T>(
    key: string,
    operation: (transaction: StateTransaction) => Promise<T>,
  ): Promise<T> {
    const root = resolve(this.directory);
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(root)) !== root
    )
      fail(
        'INVALID_STORE',
        'Use an existing private real storage directory.',
        500,
      );
    const name = createHash('sha256').update(key).digest('hex');
    const file = join(root, name + '.json');
    const lock = join(root, name + '.lock');
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        fail('BUSY', 'Another assistant request is running.', 409);
      throw error;
    }
    try {
      return await operation({
        load: async () => {
          try {
            const stat = await lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152)
              fail('INVALID_STORE', 'Invalid assistant storage.', 500);
            return JSON.parse(await readFile(file, 'utf8')) as StoredSession;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
        },
        save: async (value) => {
          const data = encode(value);
          if (Buffer.byteLength(data) > 2097152)
            fail('INVALID_STORE', 'Assistant storage limit reached.', 500);
          const temporary = join(root, name + '.' + randomUUID() + '.tmp');
          try {
            await writeFile(temporary, data, {
              flag: 'wx',
              mode: 0o600,
              flush: true,
            });
            await rename(temporary, file);
          } finally {
            await unlink(temporary).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
            });
          }
        },
      });
    } finally {
      await rmdir(lock);
    }
  }
}
