import { createHash, randomUUID } from 'node:crypto';

export class StoreError extends Error {
  constructor(code, message, status = 503, retryAfter) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class PostgresConversationStore {
  constructor(pool) {
    this.pool = pool;
  }

  async ready() {
    const result = await this.pool.query(
      'SELECT version FROM pagesquire_private.schema_version WHERE version = 1',
    );
    if (result.rowCount !== 1)
      throw new StoreError(
        'STORE_UNAVAILABLE',
        'Assistant storage is unavailable.',
      );
  }

  async transaction(key, operation) {
    const id = createHash('sha256').update(key).digest('hex');
    const owner = randomUUID();
    const acquired = await this.pool.query(
      `
      INSERT INTO pagesquire_private.sessions (id, lease_owner, lease_until)
      VALUES ($1, $2, clock_timestamp() + interval '90 seconds')
      ON CONFLICT (id) DO UPDATE SET
        lease_owner = EXCLUDED.lease_owner,
        lease_until = EXCLUDED.lease_until,
        fence = pagesquire_private.sessions.fence + 1,
        payload = CASE WHEN pagesquire_private.sessions.expires_at <= clock_timestamp() THEN NULL ELSE pagesquire_private.sessions.payload END,
        expires_at = clock_timestamp() + interval '2 hours'
      WHERE pagesquire_private.sessions.lease_until <= clock_timestamp()
      RETURNING fence`,
      [id, owner],
    );
    if (acquired.rowCount !== 1)
      throw new StoreError(
        'BUSY',
        'Another request is running. Try again shortly.',
        409,
      );
    const fence = acquired.rows[0].fence;
    try {
      return await operation({
        load: async () => {
          const result = await this.pool.query(
            `SELECT payload FROM pagesquire_private.sessions
            WHERE id = $1 AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp()`,
            [id, owner, fence],
          );
          if (result.rowCount !== 1)
            throw new StoreError(
              'LEASE_LOST',
              'The assistant request expired.',
            );
          return result.rows[0].payload;
        },
        save: async (value) => {
          const payload = JSON.stringify(value);
          if (Buffer.byteLength(payload) > 1500000)
            throw new StoreError(
              'STATE_LIMIT',
              'Start a new conversation.',
              413,
            );
          const result = await this.pool.query(
            `UPDATE pagesquire_private.sessions SET payload = $4::jsonb,
            expires_at = clock_timestamp() + interval '2 hours'
            WHERE id = $1 AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp()`,
            [id, owner, fence, payload],
          );
          if (result.rowCount !== 1)
            throw new StoreError(
              'LEASE_LOST',
              'The assistant request expired.',
            );
        },
      });
    } finally {
      await this.pool.query(
        `UPDATE pagesquire_private.sessions SET lease_owner = NULL, lease_until = '-infinity'
        WHERE id = $1 AND lease_owner = $2 AND fence = $3`,
        [id, owner, fence],
      );
    }
  }

  async consume(id, maximum, seconds) {
    const result = await this.pool.query(
      `INSERT INTO pagesquire_private.budgets (id, count, expires_at)
      VALUES ($1, 1, clock_timestamp() + $3 * interval '1 second')
      ON CONFLICT (id) DO UPDATE SET
        count = CASE WHEN pagesquire_private.budgets.expires_at <= clock_timestamp() THEN 1 ELSE pagesquire_private.budgets.count + 1 END,
        expires_at = CASE WHEN pagesquire_private.budgets.expires_at <= clock_timestamp() THEN EXCLUDED.expires_at ELSE pagesquire_private.budgets.expires_at END
      WHERE pagesquire_private.budgets.expires_at <= clock_timestamp() OR pagesquire_private.budgets.count < $2
      RETURNING count`,
      [id, maximum, seconds],
    );
    if (result.rowCount !== 1)
      throw new StoreError(
        'RATE_LIMITED',
        'The demo usage limit was reached. Try again later.',
        429,
        seconds,
      );
  }

  async cleanup() {
    await this.pool.query(`DELETE FROM pagesquire_private.sessions WHERE id IN
      (SELECT id FROM pagesquire_private.sessions WHERE expires_at < clock_timestamp() AND lease_until <= clock_timestamp() LIMIT 100)`);
    await this.pool.query(`DELETE FROM pagesquire_private.budgets WHERE id IN
      (SELECT id FROM pagesquire_private.budgets WHERE expires_at < clock_timestamp() LIMIT 100)`);
  }
}
