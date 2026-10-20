BEGIN;
CREATE SCHEMA IF NOT EXISTS pagesquire_private;
REVOKE ALL ON SCHEMA pagesquire_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pagesquire_private.schema_version (
    version integer PRIMARY KEY,
    installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS pagesquire_private.sessions (
    id text PRIMARY KEY CHECK (length(id) = 64),
    payload jsonb CHECK (payload IS NULL OR (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 2097152)),
    fence bigint NOT NULL DEFAULT 1,
    lease_owner uuid,
    lease_until timestamptz NOT NULL DEFAULT '-infinity',
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 hours'
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON pagesquire_private.sessions (expires_at);

CREATE TABLE IF NOT EXISTS pagesquire_private.budgets (
    id text PRIMARY KEY CHECK (length(id) <= 180),
    count integer NOT NULL CHECK (count > 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS budgets_expiry ON pagesquire_private.budgets (expires_at);

ALTER TABLE pagesquire_private.schema_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagesquire_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagesquire_private.budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA pagesquire_private FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON SCHEMA pagesquire_private FROM anon;
        REVOKE ALL ON ALL TABLES IN SCHEMA pagesquire_private FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON SCHEMA pagesquire_private FROM authenticated;
        REVOKE ALL ON ALL TABLES IN SCHEMA pagesquire_private FROM authenticated;
    END IF;
END $$;
INSERT INTO pagesquire_private.schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
