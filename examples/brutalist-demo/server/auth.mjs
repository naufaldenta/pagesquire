import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { isIP } from 'node:net';

export function equalSecret(left, right) {
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(left), hash(right));
}

export function createSessions(
  config,
  now = () => Math.floor(Date.now() / 1000),
) {
  const secret = Buffer.from(config.sessionSecret, 'hex');
  const mac = (text) => createHmac('sha256', secret).update(text).digest('hex');
  const name = config.secure
    ? '__Host-pagesquire_session'
    : 'pagesquire_demo_session';
  const revision = mac(`access:${config.accessCode}`);
  const cookie = (value, age) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  function read(request) {
    const cookies = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (cookies.length !== 1) return null;
    const token = cookies[0].slice(name.length + 1);
    if (token.length > 500) return null;
    const [payload, signature, extra] = token.split('.');
    if (
      extra ||
      !payload ||
      !signature ||
      !equalSecret(mac(payload), signature)
    )
      return null;
    try {
      const data = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      if (
        data.v !== 1 ||
        !/^[a-f0-9]{48}$/.test(data.id) ||
        !Number.isInteger(data.exp) ||
        data.exp <= now() ||
        data.exp > now() + 3600 ||
        data.revision !== revision
      )
        return null;
      return {
        key: data.id,
        principal: revision,
        csrfToken: mac(`csrf:${payload}`),
      };
    } catch {
      return null;
    }
  }
  return {
    read,
    mac,
    create() {
      const payload = Buffer.from(
        JSON.stringify({
          v: 1,
          id: randomBytes(24).toString('hex'),
          exp: now() + 3600,
          revision,
        }),
      ).toString('base64url');
      const token = `${payload}.${mac(payload)}`;
      return { cookie: cookie(token, 3600), csrfToken: mac(`csrf:${payload}`) };
    },
    clear: () => cookie('', 0),
    clientKey(request) {
      const raw = config.trustVercel
        ? (request.headers.get('x-vercel-forwarded-for') ??
          request.headers.get('x-forwarded-for'))
        : null;
      const address = raw?.trim();
      return mac(`ip:${address && isIP(address) ? address : 'shared-unknown'}`);
    },
  };
}
