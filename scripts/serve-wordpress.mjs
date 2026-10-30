import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, run, wordpressPhpFlags } from './wordpress-tools.mjs';
import { site } from './prepare-wordpress.mjs';

const loaded =
  (
    await run('php', [
      '-r',
      'echo extension_loaded("Zend OPcache") ? "yes" : "no";',
    ])
  ).trim() === 'yes';
const flags = wordpressPhpFlags(process.platform, loaded);
console.error(
  'WordPress PHP fixture: ' +
    (
      await run('php', [
        ...flags,
        '-r',
        'echo json_encode(["php"=>PHP_VERSION,"os"=>PHP_OS_FAMILY,"bits"=>PHP_INT_SIZE*8,"pcre"=>PCRE_VERSION,"pcreJit"=>ini_get("pcre.jit"),"cliOpcache"=>ini_get("opcache.enable_cli")]);',
      ])
    ).trim(),
);
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
// The router logs each request before handling it. Keep the latest ones and
// print them only if PHP exits, to show which request crashed it.
const recent = [];
server.stderr.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split(/\r?\n/);
  pending = lines.pop();
  for (const line of lines) {
    if (line.includes('pagesquire-request ')) {
      recent.push(line);
      if (recent.length > 20) recent.shift();
    } else if (!/Accepted$|Closing$|\[[1-5][0-9]{2}\]:/.test(line))
      process.stderr.write(`${line}\n`);
  }
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
  const stopped = signal === 'SIGINT' || signal === 'SIGTERM';
  if (!stopped && code !== 0 && recent.length)
    process.stderr.write(
      `Last requests before the fixture exited (newest last):\n${recent.join('\n')}\n`,
    );
  process.stderr.write(
    `WordPress PHP fixture exited: code=${code ?? 'none'}, signal=${signal ?? 'none'}\n`,
  );
  process.exit(code === 0 ? 0 : 1);
});
