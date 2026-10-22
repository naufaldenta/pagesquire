import {
  CAPABILITY_AVAILABILITY_STATUSES,
  validateAppContext,
} from '@pagesquire/protocol';
import type {
  AppContextSnapshot,
  CapabilityAvailabilityStatus,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import { immutableCopy } from './json.js';
import type { CapabilityRegistry } from './registry.js';

export type AppContextField = { public: true } & (
  | { type: 'boolean'; read: () => boolean }
  | { type: 'number'; min?: number; max?: number; read: () => number }
  | { type: 'string'; maxLength?: number; read: () => string }
  | { type: 'enum'; values: readonly string[]; read: () => string }
);
export interface AppContextOptions {
  registry: CapabilityRegistry;
  fields?: Readonly<Record<string, AppContextField>>;
  availability?: Readonly<Record<string, () => CapabilityAvailabilityStatus>>;
}

function invalidOptions(): never {
  throw new PageSquireError(
    'INVALID_OPTIONS',
    'Provide explicit public typed fields and registered read-only availability checks.',
  );
}

function entries(value: unknown, limit: number): [string, unknown][] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidOptions();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(fields).length > limit ||
    Object.values(fields).some((field) => !('value' in field))
  )
    invalidOptions();
  return Object.entries(fields).map(([name, descriptor]) => [
    name,
    descriptor.value,
  ]);
}

/** Incorrect async hooks never become state or leave an unhandled rejection. */
function isAsync(value: unknown): boolean {
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    return true;
  }
  return false;
}

/** Explicit host-selected public state only; never automatic DOM/store discovery. */
export class AppContext {
  readonly registry: CapabilityRegistry;
  private readonly fields = new Map<string, AppContextField>();
  private readonly availability = new Map<
    string,
    () => CapabilityAvailabilityStatus
  >();

  constructor(options: AppContextOptions) {
    this.registry = options.registry;
    const ids = new Set(this.registry.list().map((entry) => entry.id));
    for (const [name, input] of entries(options.fields ?? {}, 20)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) invalidOptions();
      const field = Object.fromEntries(entries(input, 6));
      if (
        field.public !== true ||
        typeof field.read !== 'function' ||
        Object.keys(field).some(
          (key) =>
            ![
              'public',
              'read',
              'type',
              'min',
              'max',
              'maxLength',
              'values',
            ].includes(key),
        )
      )
        invalidOptions();
      const number = (value: unknown) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= 1e12;
      if (field.type === 'number') {
        if (
          (field.min !== undefined && !number(field.min)) ||
          (field.max !== undefined && !number(field.max)) ||
          Number(field.min ?? -1e12) > Number(field.max ?? 1e12) ||
          'maxLength' in field ||
          'values' in field
        )
          invalidOptions();
      } else if (field.type === 'string') {
        if (
          !Number.isInteger(field.maxLength ?? 120) ||
          Number(field.maxLength ?? 120) < 1 ||
          Number(field.maxLength ?? 120) > 200 ||
          'min' in field ||
          'max' in field ||
          'values' in field
        )
          invalidOptions();
      } else if (field.type === 'enum') {
        let values: unknown;
        try {
          values = immutableCopy(field.values);
        } catch {
          invalidOptions();
        }
        if (
          !Array.isArray(values) ||
          !values.length ||
          values.length > 50 ||
          values.some(
            (value) => typeof value !== 'string' || value.length > 200,
          ) ||
          new Set(values).size !== values.length ||
          'min' in field ||
          'max' in field ||
          'maxLength' in field
        )
          invalidOptions();
        field.values = values;
      } else if (
        field.type !== 'boolean' ||
        Object.keys(field).some(
          (key) => !['public', 'read', 'type'].includes(key),
        )
      )
        invalidOptions();
      this.fields.set(name, Object.freeze(field) as unknown as AppContextField);
    }
    for (const [id, callback] of entries(options.availability ?? {}, 100)) {
      if (!ids.has(id) || typeof callback !== 'function') invalidOptions();
      this.availability.set(id, callback as () => CapabilityAvailabilityStatus);
    }
  }

  checkAvailability(id: string): CapabilityAvailabilityStatus | 'not_checked' {
    const check = this.availability.get(id);
    if (!check) return 'not_checked';
    try {
      const value: unknown = check();
      return !isAsync(value) &&
        CAPABILITY_AVAILABILITY_STATUSES.includes(
          value as CapabilityAvailabilityStatus,
        )
        ? (value as CapabilityAvailabilityStatus)
        : 'check_failed';
    } catch {
      return 'check_failed';
    }
  }

  assertAvailable(id: string): void {
    if (
      !['not_checked', 'available', 'needs_preparation'].includes(
        this.checkAvailability(id),
      )
    ) {
      throw new PageSquireError(
        'CAPABILITY_UNAVAILABLE',
        'This action is not available in the current app state. No handler was run.',
      );
    }
  }

  snapshot(): AppContextSnapshot {
    try {
      const fields = [...this.fields].map(([name, field]) => {
        const value: unknown = field.read();
        if (
          isAsync(value) ||
          (field.type === 'boolean'
            ? typeof value !== 'boolean'
            : field.type === 'number'
              ? typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < (field.min ?? -1e12) ||
                value > (field.max ?? 1e12)
              : typeof value !== 'string' ||
                (field.type === 'enum'
                  ? !field.values.includes(value)
                  : value.length > (field.maxLength ?? 120)))
        )
          throw Error();
        return { name, value: value as string | number | boolean };
      });
      const availability = [...this.availability.keys()].map(
        (capabilityId) => ({
          capabilityId,
          status: this.checkAvailability(
            capabilityId,
          ) as CapabilityAvailabilityStatus,
        }),
      );
      const snapshot: AppContextSnapshot = {
        schemaVersion: 1,
        fields,
        availability,
      };
      if (!validateAppContext(snapshot).valid) throw Error();
      return immutableCopy(snapshot);
    } catch {
      throw new PageSquireError(
        'APP_CONTEXT_INVALID',
        'The public app context could not be read within its declared types and limits.',
      );
    }
  }
}
