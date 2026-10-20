import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class OnboardingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const json = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const deniedPart =
  /^(?:\..*|node_modules|vendor|storage|cache|logs?|uploads?|backups?|secrets?|private|config|dist|build|coverage|tests?|pagesquire|wp-content|wp-includes|wp-admin)$/i;
const deniedName =
  /(?:^\.|(?:^|[._-])(?:env|config|credentials?|passwords?|tokens?|secrets?|private|backup|lock|log|keys?)(?:[._-]|$)|\.min\.)/i;
export function excludedPath(name: string): boolean {
  return (
    name.split('/').some((part) => deniedPart.test(part)) ||
    deniedName.test(path.posix.basename(name))
  );
}

export class ProjectFiles {
  private constructor(readonly root: string) {}
  static async at(root: string): Promise<ProjectFiles> {
    return new ProjectFiles(await realpath(root));
  }
  relative(value: string): string {
    if (
      !value ||
      value.includes('\\') ||
      value.includes('\0') ||
      /[\r\n]/.test(value) ||
      path.isAbsolute(value) ||
      value
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /[<>:"|?*\x00-\x1f]/.test(part) ||
            /[. ]$/.test(part) ||
            part !== part.trim() ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    ) {
      throw new OnboardingError(
        'UNSAFE_PATH',
        'Use normalized project-relative paths without traversal.',
      );
    }
    return value;
  }
  async resolve(value: string): Promise<string> {
    this.relative(value);
    let current = this.root;
    for (const part of value.split('/')) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new OnboardingError(
            'SYMLINK_REFUSED',
            'PageSquire does not follow project symlinks or junctions.',
          );
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current;
  }
  async read(value: string, maximum = 65536): Promise<string> {
    const file = await this.resolve(value);
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maximum)
        throw new OnboardingError(
          'FILE_TOO_LARGE',
          'A project input exceeds its permitted size.',
        );
      const buffer = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maximum || bytesRead !== stat.size)
        throw new OnboardingError(
          'FILE_CHANGED',
          'A project input changed during reading.',
        );
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
  async readJson(value: string, maximum = 65536): Promise<unknown> {
    try {
      return JSON.parse(await this.read(value, maximum)) as unknown;
    } catch (error: unknown) {
      if (error instanceof OnboardingError) throw error;
      throw new OnboardingError(
        'INVALID_JSON',
        'A required project JSON file is missing or invalid.',
      );
    }
  }
  async exists(value: string): Promise<boolean> {
    try {
      await lstat(await this.resolve(value));
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  /** Refuse every conflict before writing any item; identical installations are idempotent. */
  async create(files: Readonly<Record<string, string>>): Promise<void> {
    const pending: Array<[string, string]> = [];
    for (const [name, content] of Object.entries(files)) {
      const target = await this.resolve(name);
      if (await this.exists(name)) {
        if ((await this.read(name, 2_000_000)) !== content)
          throw new OnboardingError(
            'FILE_CONFLICT',
            'An onboarding file already exists with different content. Nothing was overwritten.',
          );
      } else pending.push([target, content]);
    }
    for (const [target, content] of pending) {
      await mkdir(path.dirname(target), { recursive: true });
      const handle = await open(target, 'wx');
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
    }
  }
  /** Replace only an artifact positively identified as PageSquire-owned. */
  async artifact(
    name: string,
    content: string,
    owned: (existing: string) => boolean,
  ): Promise<void> {
    const target = await this.resolve(name);
    if ((await this.exists(name)) && !owned(await this.read(name, 2_000_000)))
      throw new OnboardingError(
        'FILE_CONFLICT',
        'Refusing to replace a file not owned by PageSquire.',
      );
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${name}.${randomUUID()}.tmp`;
    const temporaryPath = await this.resolve(temporary);
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, target);
    } catch (error) {
      await unlink(temporaryPath);
      throw error;
    }
  }
}
