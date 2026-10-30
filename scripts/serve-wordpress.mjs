import { spawn } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
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
const runtime = (
  await run('php', [
    ...flags,
    '-r',
    'echo json_encode(["php"=>PHP_VERSION,"os"=>PHP_OS_FAMILY,"bits"=>PHP_INT_SIZE*8,"pcre"=>PCRE_VERSION,"pcreJit"=>ini_get("pcre.jit"),"cliOpcache"=>ini_get("opcache.enable_cli"),"pcntl"=>function_exists("pcntl_signal")]);',
  ])
).trim();
console.error(`WordPress PHP fixture: ${runtime}`);
const { pcntl } = JSON.parse(runtime);
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
// The router logs each request before and after handling it. Keep the latest
// ones and print them only if PHP exits, to show which request crashed it.
const recent = [];
// The built-in server handles one request at a time, so at most one is open.
let open = null;
server.stderr.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split(/\r?\n/);
  pending = lines.pop();
  for (const line of lines) {
    if (line.includes('pagesquire-request-done')) open = null;
    else if (line.includes('pagesquire-request ')) {
      recent.push(line);
      if (recent.length > 20) recent.shift();
      open = {
        request: line.slice(line.indexOf('pagesquire-request ') + 19),
        since: Date.now(),
        reports: 0,
      };
    } else if (!/Accepted$|Closing$|\[[1-5][0-9]{2}\]:/.test(line))
      process.stderr.write(`${line}\n`);
  }
});

// What the PHP process is doing, from Linux /proc: state R with rising CPU
// time is a loop, state S or D names what it waits on.
async function processState(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const wchan = await readFile(`/proc/${pid}/wchan`, 'utf8').catch(() => '?');
  const files = [];
  for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => []))
    files.push(await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '?'));
  return `state=${fields[0]} cpuTicks=${Number(fields[11]) + Number(fields[12])} wchan=${wchan || '0'} files=${files.join(', ')}`;
}

// A hung request otherwise only shows up as browser timeouts in the tests.
setInterval(async () => {
  // Reported at 20s and again at 30s, so the CPU time shows whether it moves.
  if (!open || open.reports >= 2) return;
  if (Date.now() - open.since < 20000 + open.reports * 10000) return;
  const current = open;
  current.reports++;
  let report = `PHP has been handling ${current.request} for ${Math.round((Date.now() - current.since) / 1000)}s`;
  if (process.platform === 'linux')
    report += `\n  ${await processState(server.pid).catch((error) => error.message)}`;
  process.stderr.write(`${report}\n`);
  // The router's handler is gone once the request ends, and SIGUSR1 would then
  // stop PHP, so it is sent only for a request that is still open.
  if (pcntl && current.reports === 1 && open === current)
    server.kill('SIGUSR1');
}, 5000).unref();
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
