import { fileURLToPath } from 'node:url';
export default {
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ['@pagesquire/server'],
  devIndicators: false,
};
