import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { disposablePostgresOptions } from '../fixtures/disposable-postgres.mjs';
import { PostgresConversationStore } from '../../examples/brutalist-demo/server/store.mjs';
// Node 24 strips these erasable types; this helper has no runtime engine/provider dependency.
import { forgetConversation } from '../../packages/server/src/privacy.ts';

test(
  'OFFBEAT real PostgreSQL durability, concurrent budgets, fenced leases and privacy',
  { skip: !process.env.PAGESQUIRE_TEST_DATABASE_URL },
  async (t) => {
    const url = process.env.PAGESQUIRE_TEST_DATABASE_URL;
    // Construct only validated fields: pg URL query parameters can override host/database.
    const pool = new pg.Pool(disposablePostgresOptions(url));
    const prefix = `test:${randomUUID()}`;
    const keys = ['durable', 'lease', 'oversize', 'cleanup', 'privacy'].map(
      (key) => `${prefix}:${key}`,
    );
    const ids = keys.map((key) =>
      createHash('sha256').update(key).digest('hex'),
    );
    const budgets = [`${prefix}:budget`, `${prefix}:cleanup`];
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
              [budgets[0]],
            )
          ).rows[0].count,
          3,
        );
        await pool.query(
          "UPDATE pagesquire_private.budgets SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
          [budgets[0]],
        );
        await store.consume(budgets[0], 3, 60);
        assert.equal(
          (
            await pool.query(
              'SELECT count FROM pagesquire_private.budgets WHERE id = $1',
              [budgets[0]],
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
    for (const kind of ['sessions', 'budgets']) {
      await t.test(
        `cleanup cannot delete a concurrently refreshed ${kind} row`,
        async () => {
          const id = kind === 'sessions' ? ids[3] : budgets[1];
          if (kind === 'sessions') {
            await store.transaction(keys[3], (tx) =>
              tx.save({ synthetic: true }),
            );
          } else {
            await store.consume(id, 3, 60);
          }
          await pool.query(
            `UPDATE pagesquire_private.${kind} SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
            [id],
          );
          const locker = await pool.connect();
          const cleaner = await pool.connect();
          let cleaning;
          try {
            await locker.query('BEGIN');
            await locker.query(
              kind === 'sessions'
                ? "UPDATE pagesquire_private.sessions SET expires_at = clock_timestamp() + interval '2 hours', lease_until = clock_timestamp() + interval '90 seconds' WHERE id = $1"
                : "UPDATE pagesquire_private.budgets SET expires_at = clock_timestamp() + interval '1 minute', count = 2 WHERE id = $1",
              [id],
            );
            const pid = (await cleaner.query('SELECT pg_backend_pid() AS pid'))
              .rows[0].pid;
            let finished = false;
            cleaning = new PostgresConversationStore({
              query: (...args) => cleaner.query(...args),
            })
              .cleanup()
              .finally(() => {
                finished = true;
              });
            // Observe a real lock wait (old implementation) or completion (SKIP LOCKED),
            // not a timing guess about when the cleanup snapshot was taken.
            const deadline = Date.now() + 3000;
            let waiting = false;
            while (!finished && Date.now() < deadline) {
              waiting =
                (
                  await pool.query(
                    "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
                    [pid],
                  )
                ).rowCount === 1;
              if (waiting) break;
              await delay(10);
            }
            assert.ok(
              finished || waiting,
              'Cleanup must complete or reach the observed row lock before the refresh commits.',
            );
            await locker.query('COMMIT');
            await cleaning;
            const row = await pool.query(
              `SELECT * FROM pagesquire_private.${kind} WHERE id = $1`,
              [id],
            );
            assert.equal(
              row.rowCount,
              1,
              'Cleanup must not remove newly active session data or reset a refreshed cost bucket.',
            );
            if (kind === 'budgets') assert.equal(row.rows[0].count, 2);
          } finally {
            await locker.query('ROLLBACK');
            await cleaning?.catch(() => {});
            locker.release();
            cleaner.release();
          }
        },
      );
    }
    await t.test(
      'authorized erasure is a durable transcript-only checkpoint, not a shared budget reset',
      async () => {
        const rate = { since: Math.floor(Date.now() / 1000), count: 20 };
        const principal = 'synthetic:privacy';
        await store.transaction(keys[4], (tx) =>
          tx.save({
            principal,
            rate,
            state: {
              messages: ['TRANSCRIPT_CANARY'],
              pending: { callId: 'old-call' },
            },
          }),
        );
        const budgetBefore = (
          await pool.query(
            'SELECT count FROM pagesquire_private.budgets WHERE id = $1',
            [budgets[0]],
          )
        ).rows[0].count;
        await assert.rejects(forgetConversation(store, keys[4], 'other-user'), {
          code: 'ACCESS_DENIED',
        });
        await store.transaction(keys[4], async () => {
          await assert.rejects(forgetConversation(store, keys[4], principal), {
            code: 'BUSY',
          });
        });
        assert.equal(await forgetConversation(store, keys[4], principal), true);
        assert.equal(
          await forgetConversation(store, keys[4], principal),
          false,
        );
        await store.transaction(keys[4], async (tx) =>
          assert.deepEqual(await tx.load(), { principal, rate, state: null }),
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count FROM pagesquire_private.budgets WHERE id = $1',
              [budgets[0]],
            )
          ).rows[0].count,
          budgetBefore,
        );
      },
    );
    await t.test(
      'cleanup removes expired unlocked data in bounded batches while retaining active leases and budgets',
      async () => {
        const expiredIds = Array.from({ length: 101 }, (_, i) =>
          createHash('sha256').update(`${prefix}:expired:${i}`).digest('hex'),
        );
        const expiredBudgets = Array.from(
          { length: 101 },
          (_, i) => `${prefix}:expired:${i}`,
        );
        ids.push(...expiredIds);
        budgets.push(...expiredBudgets);
        await pool.query(
          "INSERT INTO pagesquire_private.sessions (id, expires_at) SELECT unnest($1::text[]), clock_timestamp() - interval '1 minute'",
          [expiredIds],
        );
        await pool.query(
          "INSERT INTO pagesquire_private.budgets (id, count, expires_at) SELECT unnest($1::text[]), 1, clock_timestamp() - interval '1 minute'",
          [expiredBudgets],
        );
        await store.cleanup();
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.sessions WHERE id = ANY($1::text[])',
              [expiredIds],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.budgets WHERE id = ANY($1::text[])',
              [expiredBudgets],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.sessions WHERE id = $1',
              [ids[3]],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.budgets WHERE id = $1',
              [budgets[0]],
            )
          ).rowCount,
          1,
        );
        await store.cleanup();
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.sessions WHERE id = ANY($1::text[])',
              [expiredIds],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT 1 FROM pagesquire_private.budgets WHERE id = ANY($1::text[])',
              [expiredBudgets],
            )
          ).rowCount,
          0,
        );
      },
    );
  },
);
