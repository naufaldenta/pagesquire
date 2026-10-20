import { providerConfigurationFromEnv } from '../../../packages/server/dist/index.js';
export { createPool } from './database.mjs';

export function readConfig(env = process.env) {
  const required = [
    'MODEL',
    'API_KEY',
    'SESSION_SECRET',
    'DEMO_ACCESS_CODE',
    'DATABASE_URL',
    'PUBLIC_ORIGIN',
  ];
  const value = {};
  for (const name of required) {
    const item = env[`PAGESQUIRE_${name}`];
    if (typeof item !== 'string' || !item.trim())
      throw Error('Assistant configuration is incomplete.');
    value[name] = item.trim();
  }
  const origin = new URL(value.PUBLIC_ORIGIN);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(
    origin.hostname,
  );
  if (
    origin.origin !== value.PUBLIC_ORIGIN ||
    (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
  )
    throw Error('Configure an exact secure public origin.');
  const providerConfig = providerConfigurationFromEnv(env);
  const database = new URL(value.DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.password
  )
    throw Error('Invalid server-owned connection configuration.');
  if (
    !/^[a-f0-9]{64}$/i.test(value.SESSION_SECRET) ||
    value.DEMO_ACCESS_CODE.length < 12 ||
    value.DEMO_ACCESS_CODE.length > 256 ||
    value.MODEL.length > 200 ||
    /[\r\n]/.test(value.API_KEY)
  )
    throw Error('Invalid private assistant configuration.');
  if (env.PAGESQUIRE_STORAGE_DRIVER !== 'supabase-postgres')
    throw Error('Select the supported Supabase PostgreSQL store.');
  function limit(name, fallback, maximum) {
    const result = Number(env[`PAGESQUIRE_${name}`] ?? fallback);
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
      throw Error('Invalid usage limit.');
    return result;
  }
  return {
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    providerUrl: providerConfig.endpoint,
    providerConfig,
    model: value.MODEL,
    apiKey: value.API_KEY,
    sessionSecret: value.SESSION_SECRET,
    accessCode: value.DEMO_ACCESS_CODE,
    databaseUrl: value.DATABASE_URL,
    databaseCa: env.PAGESQUIRE_DATABASE_CA,
    dailyLimit: limit('DAILY_REQUEST_LIMIT', 100, 10000),
    ipDailyLimit: limit('IP_DAILY_REQUEST_LIMIT', 25, 1000),
    trustVercel: env.VERCEL === '1',
  };
}
