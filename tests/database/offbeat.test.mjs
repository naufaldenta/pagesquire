import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPool } from '../../examples/brutalist-demo/server/database.mjs';
import { PostgresConversationStore } from '../../examples/brutalist-demo/server/store.mjs';

test(
  'OFFBEAT real PostgreSQL durability, concurrent budgets, fenced leases and privacy',
  { skip: !process.env.PAGESQUIRE_TEST_DATABASE_URL },
  async (t) => {
    const url = process.env.PAGESQUIRE_TEST_DATABASE_URL;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(url).hostname,
    );
    // Only the disposable loopback CI database is unencrypted. Hosted databases always verify TLS.
    const pool = local
      ? new pg.Pool({ connectionString: url, max: 5 })
      : createPool(url, process.env.PAGESQUIRE_TEST_DATABASE_CA);
    const prefix = `test:${randomUUID()}`;
    const keys = ['durable', 'lease', 'oversize'].map(
      (key) => `${prefix}:${key}`,
    );
    const ids = keys.map((key) =>
      createHash('sha256').update(key).digest('hex'),
    );
    const budgets = [`${prefix}:budget`];
    t.after(async () => {
      await pool.query(
        'DELETE FROM pagesquire_private.sessions WHERE id = ANY($1::text[])',
        [ids],
      );
      await pool.query(
        'DELETE FROM pagesquire_private.budgets WHERE id = ANY($1::text[])',
        [budgets],
      );
      await pool.end();
    });
    if (local)
      await pool.query(
        await readFile(
          new URL(
            '../../examples/brutalist-demo/server/migrations/001_private_assistant.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    const store = new PostgresConversationStore(pool);
    await store.ready();

    await t.test(
      'each save commits before a failed operation; fresh instances see it',
      async () => {
        await assert.rejects(
          store.transaction(keys[0], async (tx) => {
            assert.equal(await tx.load(), null);
            await tx.save({ charged: 1 });
            assert.deepEqual(
              (
                await pool.query(
                  'SELECT payload FROM pagesquire_private.sessions WHERE id = $1',
                  [ids[0]],
                )
              ).rows[0].payload,
              { charged: 1 },
            );
            throw Error('provider failed after committed checkpoint');
          }),
        );
        await new PostgresConversationStore(pool).transaction(
          keys[0],
          async (tx) => assert.deepEqual(await tx.load(), { charged: 1 }),
        );
      },
    );
    await t.test(
      'atomic shared quotas admit exactly maximum under concurrency and reset after expiry',
      async () => {
        const result = await Promise.allSettled(
          Array.from({ length: 12 }, () =>
            new PostgresConversationStore(pool).consume(budgets[0], 3, 60),
          ),
        );
        assert.equal(
          result.filter((entry) => entry.status === 'fulfilled').length,
          3,
        );
        for (const entry of result.filter(
          (entry) => entry.status === 'rejected',
        ))
          assert.equal(entry.reason.code, 'RATE_LIMITED');
        assert.equal(
          (
            await pool.query(
              'SELECT count FROM pagesquire_private.budgets WHERE id = $1',
              budgets,
            )
          ).rows[0].count,
          3,
        );
        await pool.query(
          "UPDATE pagesquire_private.budgets SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
          budgets,
        );
        await store.consume(budgets[0], 3, 60);
        assert.equal(
          (
            await pool.query(
              'SELECT count FROM pagesquire_private.budgets WHERE id = $1',
              budgets,
            )
          ).rows[0].count,
          1,
        );
      },
    );
    await t.test(
      'competing writers fail closed; expired lease owners cannot save or release a successor',
      async () => {
        await store.transaction(keys[1], async (old) => {
          await old.save({ initial: true });
          await assert.rejects(
            store.transaction(keys[1], async () => {}),
            { code: 'BUSY' },
          );
          await pool.query(
            "UPDATE pagesquire_private.sessions SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1",
            [ids[1]],
          );
          await new PostgresConversationStore(pool).transaction(
            keys[1],
            async (fresh) => {
              await assert.rejects(old.save({ stale: true }), {
                code: 'LEASE_LOST',
              });
              await fresh.save({ successor: true });
            },
          );
        });
        await store.transaction(keys[1], async (tx) =>
          assert.deepEqual(await tx.load(), { successor: true }),
        );
      },
    );
    await t.test(
      'expired payload resets; oversized JSON is refused; all tables have RLS',
      async () => {
        await pool.query(
          "UPDATE pagesquire_private.sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
          [ids[0]],
        );
        await store.transaction(keys[0], async (tx) =>
          assert.equal(await tx.load(), null),
        );
        await assert.rejects(
          store.transaction(keys[2], async (tx) =>
            tx.save({ huge: 'x'.repeat(1500001) }),
          ),
          { code: 'STATE_LIMIT' },
        );
        const tables = await pool.query(
          "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'pagesquire_private'",
        );
        assert.equal(tables.rowCount, 3);
        assert.ok(tables.rows.every((table) => table.rowsecurity));
        for (const role of ['anon', 'authenticated']) {
          if (
            (
              await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
                role,
              ])
            ).rowCount
          ) {
            assert.equal(
              (
                await pool.query(
                  "SELECT has_schema_privilege($1, 'pagesquire_private', 'USAGE') AS allowed",
                  [role],
                )
              ).rows[0].allowed,
              false,
            );
          }
        }
      },
    );
  },
);
