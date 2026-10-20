import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, run } from './wordpress-tools.mjs';
import { site } from './prepare-wordpress.mjs';

const loaded =
  process.platform !== 'win32' &&
  (
    await run('php', [
      '-r',
      'echo extension_loaded("Zend OPcache") ? "yes" : "no";',
    ])
  ).trim() === 'yes';
const flags = [
  ...(loaded || process.platform === 'win32'
    ? []
    : ['-d', 'zend_extension=opcache']),
  '-d',
  `opcache.enable_cli=${process.platform === 'win32' ? '0' : '1'}`,
];
const server = spawn(
  'php',
  [
    ...flags,
    '-S',
    '127.0.0.1:4177',
    '-t',
    site,
    path.join(root, 'examples/wordpress/router.php'),
  ],
  { stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true },
);
let pending = '';
server.stderr.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split(/\r?\n/);
  pending = lines.pop();
  for (const line of lines)
    if (!/Accepted$|Closing$|\[[1-5][0-9]{2}\]:/.test(line))
      process.stderr.write(`${line}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.kill(signal));
server.on('error', (error) => {
  process.stderr.write(
    `WordPress PHP fixture failed to start: ${error.message}\n`,
  );
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  if (pending) process.stderr.write(`${pending}\n`);
  process.stderr.write(
    `WordPress PHP fixture exited: code=${code ?? 'none'}, signal=${signal ?? 'none'}\n`,
  );
  process.exit(code === 0 ? 0 : 1);
});
