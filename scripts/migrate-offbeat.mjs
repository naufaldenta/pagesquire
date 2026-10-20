import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createPool } from '../examples/brutalist-demo/server/database.mjs';

let local = {};
try {
  local = parseEnv(
    await readFile(
      new URL('../examples/brutalist-demo/.env.local', import.meta.url),
      'utf8',
    ),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const env = { ...local, ...process.env };
let pool;
try {
  pool = createPool(env.PAGESQUIRE_DATABASE_URL, env.PAGESQUIRE_DATABASE_CA);
  const exists = await pool.query(
    "SELECT to_regnamespace('pagesquire_private') IS NOT NULL AS present, to_regclass('pagesquire_private.schema_version') IS NOT NULL AS owned",
  );
  if (exists.rows[0].present && !exists.rows[0].owned)
    throw Error(
      'The target schema exists without a PageSquire ownership marker. No changes made.',
    );
  if (process.argv.includes('--apply')) {
    const sql = await readFile(
      new URL(
        '../examples/brutalist-demo/server/migrations/001_private_assistant.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await pool.query(sql);
  }
  const result = await pool.query(
    'SELECT version FROM pagesquire_private.schema_version ORDER BY version',
  );
  console.log(
    JSON.stringify({
      migrated: process.argv.includes('--apply'),
      versions: result.rows.map((row) => row.version),
      tlsVerified: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      databaseReady: false,
      code: /^[A-Z0-9_]{2,60}$/.test(error.code ?? '')
        ? error.code
        : 'MIGRATION_FAILED',
    }),
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
