import type { CapabilityDefinition } from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import { immutableCopy } from './json.js';
import type { Interaction, PageObserver } from './observer.js';
import type { CapabilityRegistry } from './registry.js';

export type CapabilityInspectionStatus =
  | 'not_checked'
  | 'ready'
  | 'needs_preparation'
  | 'not_registered'
  | 'target_missing'
  | 'target_ambiguous'
  | 'target_private'
  | 'target_hidden'
  | 'target_disabled'
  | 'interaction_denied'
  | 'scope_denied'
  | 'probe_failed'
  | 'blocked_in_alpha';

/** Trusted, synchronous, read-only host code. Never prepare or execute here. */
export interface InspectorTargetProbe {
  resolve: () => Element | readonly Element[] | null;
  requiresPreparation?: boolean;
  interaction?: Interaction;
}

export interface CapabilityInspectorOptions {
  registry: CapabilityRegistry;
  observer: PageObserver;
  expected?: readonly string[];
  probes?: Readonly<Record<string, InspectorTargetProbe>>;
}

export interface CapabilityInspection {
  readonly id: string;
  readonly expected: boolean;
  readonly definition: CapabilityDefinition | null;
  readonly bindings: 'validated' | 'absent';
  readonly status: CapabilityInspectionStatus;
}

export interface CapabilityInspectionReport {
  readonly authorization: 'not_evaluated';
  readonly scope: 'not_checked' | 'allowed' | 'denied';
  readonly entries: readonly CapabilityInspection[];
  readonly counts: Readonly<{
    registered: number;
    expected: number;
    missing: number;
    ready: number;
    needsPreparation: number;
    unchecked: number;
    blocked: number;
    issues: number;
  }>;
}

const capabilityId = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function invalidOptions(): never {
  throw new PageSquireError(
    'INVALID_OPTIONS',
    'Use bounded capability IDs and explicit synchronous host target probes.',
  );
}

/** Local diagnostics only: never an authorization or execution interface. */
export class CapabilityInspector {
  readonly document: Document;
  private readonly catalog: CapabilityDefinition[];
  private readonly expected: ReadonlySet<string>;
  private readonly probes = new Map<string, InspectorTargetProbe>();
  private lastReport: CapabilityInspectionReport;

  constructor(private readonly options: CapabilityInspectorOptions) {
    this.document = options.observer.document;
    this.catalog = options.registry.list();
    const ids = new Set(this.catalog.map((entry) => entry.id));
    let expected: readonly string[];
    try {
      expected = immutableCopy(options.expected ?? [...ids]);
    } catch {
      invalidOptions();
    }
    if (
      !Array.isArray(expected) ||
      expected.length > 1000 ||
      expected.some(
        (id) =>
          typeof id !== 'string' || id.length > 128 || !capabilityId.test(id),
      ) ||
      new Set(expected).size !== expected.length
    )
      invalidOptions();
    this.expected = new Set(expected);
    if (
      options.probes !== undefined &&
      (!options.probes ||
        typeof options.probes !== 'object' ||
        Array.isArray(options.probes))
    )
      invalidOptions();
    const probes = Object.getOwnPropertyDescriptors(options.probes ?? {});
    if (Object.keys(probes).length > 1000) invalidOptions();
    for (const [id, descriptor] of Object.entries(probes)) {
      if (!ids.has(id) || !('value' in descriptor)) invalidOptions();
      const probe: unknown = descriptor.value;
      if (!probe || typeof probe !== 'object' || Array.isArray(probe))
        invalidOptions();
      const fields = Object.getOwnPropertyDescriptors(probe);
      if (
        Object.values(fields).some((field) => !('value' in field)) ||
        Object.keys(fields).some(
          (key) =>
            !['resolve', 'requiresPreparation', 'interaction'].includes(key),
        ) ||
        typeof fields.resolve?.value !== 'function' ||
        (fields.requiresPreparation &&
          typeof fields.requiresPreparation.value !== 'boolean') ||
        (fields.interaction &&
          !['click', 'fill'].includes(fields.interaction.value))
      )
        invalidOptions();
      this.probes.set(id, {
        resolve: fields.resolve.value as InspectorTargetProbe['resolve'],
        ...(fields.requiresPreparation
          ? { requiresPreparation: fields.requiresPreparation.value as boolean }
          : {}),
        ...(fields.interaction
          ? { interaction: fields.interaction.value as Interaction }
          : {}),
      });
    }
    this.lastReport = this.build(false);
  }

  /** Refresh only on host/user request. Does not take or replace a snapshot. */
  inspect(): CapabilityInspectionReport {
    this.lastReport = this.build(true);
    return this.lastReport;
  }

  /** Whitelisted metadata from the last inspection, with no new probe calls. */
  exportDiagnostics(): string {
    const report = this.lastReport;
    return JSON.stringify(
      {
        schemaVersion: 1,
        authorization: report.authorization,
        scope: report.scope,
        counts: report.counts,
        entries: report.entries.map((entry) => ({
          id: entry.id,
          expected: entry.expected,
          risk: entry.definition?.risk ?? null,
          bindings: entry.bindings,
          status: entry.status,
        })),
      },
      null,
      2,
    );
  }

  private targetStatus(
    probe: InspectorTargetProbe,
  ): CapabilityInspectionStatus {
    try {
      const resolved = probe.resolve();
      if (
        resolved &&
        typeof (resolved as unknown as { then?: unknown }).then === 'function'
      ) {
        // Consume an incorrectly supplied async probe's rejection without using its result.
        void Promise.resolve(resolved).catch(() => {});
        return 'probe_failed';
      }
      const targets = Array.isArray(resolved)
        ? resolved
        : resolved
          ? [resolved]
          : [];
      if (!targets.length) return 'target_missing';
      if (targets.length !== 1) return 'target_ambiguous';
      const target = targets[0];
      if (
        !target ||
        typeof target.matches !== 'function' ||
        typeof target.getAttribute !== 'function'
      )
        return 'probe_failed';
      if (!target.isConnected || target.ownerDocument !== this.document)
        return 'target_missing';
      if (this.options.observer.isExcluded(target)) return 'target_private';
      if (
        target.matches(':disabled') ||
        target.getAttribute('aria-disabled') === 'true'
      )
        return 'target_disabled';
      if (!this.options.observer.isVisible(target))
        return probe.requiresPreparation
          ? 'needs_preparation'
          : 'target_hidden';
      if (
        probe.interaction &&
        !this.options.observer.canInteract(target, probe.interaction)
      )
        return 'interaction_denied';
      return 'ready';
    } catch {
      return 'probe_failed';
    }
  }

  private build(check: boolean): CapabilityInspectionReport {
    let scope: CapabilityInspectionReport['scope'] = 'not_checked';
    if (check) {
      try {
        this.options.observer.observableUrl(this.document.URL);
        scope = 'allowed';
      } catch {
        scope = 'denied';
      }
    }
    const entries: CapabilityInspection[] = this.catalog.map((definition) => {
      const probe = this.probes.get(definition.id);
      const status: CapabilityInspectionStatus =
        definition.risk === 'consequential'
          ? 'blocked_in_alpha'
          : scope === 'denied'
            ? 'scope_denied'
            : check && probe
              ? this.targetStatus(probe)
              : 'not_checked';
      return Object.freeze({
        id: definition.id,
        expected: this.expected.has(definition.id),
        definition,
        bindings: 'validated',
        status,
      });
    });
    const registered = new Set(this.catalog.map((entry) => entry.id));
    for (const id of this.expected) {
      if (!registered.has(id))
        entries.push(
          Object.freeze({
            id,
            expected: true,
            definition: null,
            bindings: 'absent',
            status: 'not_registered',
          }),
        );
    }
    const count = (status: CapabilityInspectionStatus) =>
      entries.filter((entry) => entry.status === status).length;
    return Object.freeze({
      authorization: 'not_evaluated',
      scope,
      entries: Object.freeze(entries),
      counts: immutableCopy({
        registered: this.catalog.length,
        expected: this.expected.size,
        missing: count('not_registered'),
        ready: count('ready'),
        needsPreparation: count('needs_preparation'),
        unchecked: count('not_checked'),
        blocked: count('blocked_in_alpha'),
        issues: entries.filter(
          (entry) =>
            ![
              'ready',
              'not_checked',
              'needs_preparation',
              'blocked_in_alpha',
            ].includes(entry.status),
        ).length,
      }),
    });
  }
}
