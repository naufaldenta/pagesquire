import { PageSquireError } from './errors.js';

export function canonicalJson(value: unknown, maxLength = 65536): string {
  const seen = new WeakSet<object>();
  let remaining = maxLength;

  function visit(item: unknown, depth: number): string {
    if (depth > 20 || remaining < 0) {
      throw new PageSquireError('INVALID_JSON', 'JSON limits were exceeded.');
    }

    if (item === null || typeof item === 'boolean') {
      return String(item);
    }
    if (typeof item === 'string') {
      remaining -= item.length;
      if (remaining < 0) {
        throw new PageSquireError('INVALID_JSON', 'JSON limits were exceeded.');
      }
      return JSON.stringify(item);
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      return String(item);
    }
    if (typeof item !== 'object' || seen.has(item)) {
      throw new PageSquireError('INVALID_JSON', 'Expected finite JSON data.');
    }

    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) && item.length > 2000) {
      throw new PageSquireError('INVALID_JSON', 'Too many JSON array items.');
    }
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new PageSquireError('INVALID_JSON', 'Expected plain JSON objects.');
    }

    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Array.isArray(item)
      ? Array.from({ length: item.length }, (_, index) => String(index))
      : Object.keys(descriptors).sort();
    if (keys.length > 2000) {
      throw new PageSquireError('INVALID_JSON', 'Too many JSON properties.');
    }

    const values = keys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        throw new PageSquireError(
          'INVALID_JSON',
          'JSON accessors are not supported.',
        );
      }
      remaining -= key.length + 4;
      const encoded = visit(descriptor.value, depth + 1);
      return Array.isArray(item)
        ? encoded
        : `${JSON.stringify(key)}:${encoded}`;
    });
    seen.delete(item);
    return Array.isArray(item)
      ? `[${values.join(',')}]`
      : `{${values.join(',')}}`;
  }

  const serialized = visit(value, 0);
  if (serialized.length > maxLength) {
    throw new PageSquireError('INVALID_JSON', 'JSON limits were exceeded.');
  }
  return serialized;
}

export function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value, 2_000_000)) as T;
  function freeze(item: unknown): void {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}
