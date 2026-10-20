import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';

export function createPool(databaseUrl, certificate) {
  const url = new URL(databaseUrl);
  // Connection-string SSL options must never override certificate verification.
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    url.searchParams.delete(name);
  const ca = certificate
    ? new X509Certificate(
        certificate.includes('BEGIN CERTIFICATE')
          ? certificate.replaceAll('\\n', '\n')
          : readFileSync(certificate),
      ).toString()
    : undefined;
  const pool = new pg.Pool({
    connectionString: url.href,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    query_timeout: 5000,
    statement_timeout: 5000,
    application_name: 'pagesquire-offbeat',
    allowExitOnIdle: true,
  });
  pool.on('error', () => {}); // Never log driver messages that can contain connection details.
  return pool;
}
