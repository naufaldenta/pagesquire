/** Validate before constructing a pg client; never pass URL query overrides through. */
export function disposablePostgresOptions(value) {
  try {
    const target = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      !/^\/pagesquire_test(?:_[a-z0-9_]+)?$/.test(target.pathname) ||
      target.search ||
      target.hash ||
      !target.username
    )
      throw new Error();
    const user = decodeURIComponent(target.username);
    const password = decodeURIComponent(target.password);
    if (/[\u0000-\u001f\u007f]/.test(user + password)) throw new Error();
    return {
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: Number(target.port || 5432),
      database: target.pathname.slice(1),
      user,
      password,
      ssl: false,
      max: 5,
      connectionTimeoutMillis: 5000,
    };
  } catch {
    throw new Error(
      'Database tests require an explicit user, dedicated loopback pagesquire_test database, and no query or fragment.',
    );
  }
}
