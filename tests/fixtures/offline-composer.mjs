import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function lockedComposerRepository(root) {
  const lock = JSON.parse(
    await readFile(path.join(root, 'composer.lock'), 'utf8'),
  );
  return {
    type: 'package',
    package: [...lock.packages, ...lock['packages-dev']].filter(
      (item) => !item.name.startsWith('pagesquire/'),
    ),
  };
}
