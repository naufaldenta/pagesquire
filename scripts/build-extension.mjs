import path from 'node:path';
import { build } from 'esbuild';

// The companion extension's remote script (frames and shared tabs) needs the
// page observer from @pagesquire/core; everything else is loaded as written.
const root = path.resolve('packages/extension');
await build({
  entryPoints: [path.join(root, 'src/remote.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome137',
  outfile: path.join(root, 'dist/remote.js'),
  legalComments: 'none',
  // The observer needs only the protocol version, not the schema validators.
  alias: {
    '@pagesquire/protocol': path.resolve('packages/protocol/dist/types.js'),
  },
  logLevel: 'warning',
});
console.log('Built companion remote script: packages/extension/dist/remote.js');
