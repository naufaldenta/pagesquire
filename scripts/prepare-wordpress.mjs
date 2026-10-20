import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { cache, root, download, run, exists } from './wordpress-tools.mjs';

export const fixture = path.join(cache, 'fixture-7.1.3');
export const site = path.join(fixture, 'site');
await mkdir(site, { recursive: true });
const wp = await download(
  'https://downloads.wordpress.org/release/wordpress-7.1.3.zip',
  'wordpress-7.1.3.zip',
);
const sqlite = await download(
  'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.0.zip',
  'sqlite-database-integration-3.1.0.zip',
);
const cli = await download(
  'https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar',
  'wp-cli-2.12.0.phar',
  'ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c',
);
if (!(await exists(path.join(site, 'wp-includes/version.php')))) {
  const extraction = path.join(fixture, 'wordpress-source');
  await mkdir(extraction, { recursive: true });
  await run('php', [
    'scripts/wordpress-archive.php',
    'extract',
    wp,
    extraction,
  ]);
  await cp(path.join(extraction, 'wordpress'), site, { recursive: true });
}
await run('php', [
  'scripts/wordpress-archive.php',
  'extract',
  sqlite,
  path.join(site, 'wp-content/plugins'),
]);
const drop = path.join(
  site,
  'wp-content/plugins/sqlite-database-integration/db.copy',
);
if (!(await exists(drop))) {
  console.log(
    await run('php', [
      '-r',
      '$z=new ZipArchive;$z->open($argv[1]);for($i=0;$i<$z->numFiles;$i++){ $n=$z->getNameIndex($i); if(str_contains($n,"db.")||str_contains($n,"readme")){echo $n,PHP_EOL;}}',
      sqlite,
    ]),
  );
  throw Error('Inspect the current SQLite drop-in layout before proceeding.');
}
let contents = await readFile(drop, 'utf8');
contents = contents
  .replace(
    '{SQLITE_IMPLEMENTATION_FOLDER_PATH}',
    path
      .join(site, 'wp-content/plugins/sqlite-database-integration')
      .replaceAll('\\', '/'),
  )
  .replace('{SQLITE_PLUGIN}', 'sqlite-database-integration/load.php');
await writeFile(path.join(site, 'wp-content/db.php'), contents);
await mkdir(path.join(fixture, 'database'), { recursive: true });
const normalized = (value) => JSON.stringify(value.replaceAll('\\', '/'));
await writeFile(
  path.join(site, 'wp-config.php'),
  `<?php
define('DB_NAME','pagesquire_fixture');define('DB_USER','fixture');define('DB_PASSWORD','fixture');define('DB_HOST','localhost');define('DB_CHARSET','utf8mb4');define('DB_COLLATE','');
define('DB_DIR',${normalized(path.join(fixture, 'database'))});define('DB_FILE','pagesquire.sqlite');
define('AUTH_KEY','pagesquire-local-fixture-auth');define('SECURE_AUTH_KEY','pagesquire-local-fixture-secure');define('LOGGED_IN_KEY','pagesquire-local-fixture-login');define('NONCE_KEY','pagesquire-local-fixture-nonce');define('AUTH_SALT','pagesquire-local-fixture-auth-salt');define('SECURE_AUTH_SALT','pagesquire-local-fixture-secure-salt');define('LOGGED_IN_SALT','pagesquire-local-fixture-login-salt');define('NONCE_SALT','pagesquire-local-fixture-nonce-salt');
define('WP_DEBUG',true);define('WP_DEBUG_DISPLAY',false);define('WP_DEBUG_LOG',true);define('DISABLE_WP_CRON',true);define('AUTOMATIC_UPDATER_DISABLED',true);define('PAGESQUIRE_FIXTURE',true);define('PAGESQUIRE_API_KEY','pagesquire-fixture-server-key');
$table_prefix='wp_';if(!defined('ABSPATH'))define('ABSPATH',__DIR__.'/');require_once ABSPATH.'wp-settings.php';
`,
);
const wpcli = (args) =>
  run('php', [cli, `--path=${site}`, '--allow-root', ...args], {
    env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' },
  });
try {
  await wpcli(['core', 'is-installed']);
} catch {
  await wpcli([
    'core',
    'install',
    '--url=http://127.0.0.1:4177',
    '--title=PageSquire WordPress fixture',
    '--admin_user=fixture-admin',
    '--admin_password=pagesquire-fixture-password',
    '--admin_email=admin@example.test',
    '--skip-email',
  ]);
}
await mkdir(path.join(site, 'wp-content/mu-plugins'), { recursive: true });
await copyFile(
  path.join(root, 'examples/wordpress/fixture.php'),
  path.join(site, 'wp-content/mu-plugins/pagesquire-fixture.php'),
);
for (const theme of ['pagesquire-fixture', 'pagesquire-ambiguous'])
  await cp(
    path.join(root, 'examples/wordpress', theme),
    path.join(site, 'wp-content/themes', theme),
    { recursive: true },
  );
const plugin = path.join(
  root,
  'packages/wordpress/dist/pagesquire-0.1.0-alpha.0.zip',
);
await wpcli(['plugin', 'install', plugin, '--force', '--activate']);
await wpcli(['eval-file', path.join(root, 'examples/wordpress/seed.php')]);
await writeFile(
  path.join(fixture, 'prepared.json'),
  JSON.stringify({ site, wordpress: '7.1.3', sqlite: '3.1.0' }),
);
console.log(`Prepared isolated WordPress fixture at ${site}`);
