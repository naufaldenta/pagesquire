import type {
  CapabilityInspection,
  CapabilityInspectionStatus,
  CapabilityInspector,
} from '@pagesquire/core';
import { PageSquireError } from '@pagesquire/core';

const guidance: Record<CapabilityInspectionStatus, [string, string]> = {
  not_checked: [
    'Not checked',
    'Add a host-owned target probe to check DOM readiness.',
  ],
  ready: [
    'Target ready',
    'The sampled target passed the local checks. Execution and server permission are not verified.',
  ],
  needs_preparation: [
    'Needs preparation',
    'The target is hidden and the host declared preparation. Check the real handler opens it before use.',
  ],
  not_registered: [
    'Not registered',
    'Implement and validate the expected capability, or correct the expected ID.',
  ],
  target_missing: [
    'Target missing',
    'Check the current route and host target resolver. Do not substitute a nearby element.',
  ],
  target_ambiguous: [
    'Ambiguous target',
    'Make the host resolver return exactly one intended target.',
  ],
  target_private: [
    'Private target',
    'This target is excluded. Keep private controls out of the assistant catalog.',
  ],
  target_hidden: [
    'Hidden target',
    'Check visibility and implement explicit preparation if appropriate.',
  ],
  target_disabled: [
    'Disabled target',
    'The native control or its ARIA state is disabled. Do not bypass it.',
  ],
  interaction_denied: [
    'Interaction denied',
    'The local observer policy denied this interaction. Do not broaden permissions just to pass inspection.',
  ],
  scope_denied: [
    'Page outside scope',
    'Open an allowed route or review the host navigation policy.',
  ],
  probe_failed: [
    'Probe failed',
    'Check the synchronous read-only host resolver locally. Exception details are not exported.',
  ],
  blocked_in_alpha: [
    'Blocked in alpha',
    'Consequential actions remain blocked by the runtime, regardless of target readiness.',
  ],
};

/** Explicit dev/admin mount only. This is not a permission gate or tool runner. */
export function mountInspector(
  container: HTMLElement,
  inspector: CapabilityInspector,
): () => void {
  const doc = container.ownerDocument;
  if (!container.isConnected || doc !== inspector.document) {
    throw new PageSquireError(
      'INVALID_OPTIONS',
      'Mount the inspector in its attached observer document.',
    );
  }
  const lifetime = new AbortController();
  let rows = new AbortController();
  const root = doc.createElement('section');
  root.className = 'pagesquire-inspector';
  root.setAttribute('data-pagesquire-root', '');
  root.setAttribute('aria-label', 'PageSquire capability inspector');
  const heading = doc.createElement('h2');
  heading.textContent = 'Capability inspector';
  const note = doc.createElement('p');
  note.textContent =
    'Local target checks only. Server authorization and action outcomes are not evaluated. No actions or AI requests are run.';
  const coverage = doc.createElement('p');
  coverage.className = 'pagesquire-inspector-coverage';
  const controls = doc.createElement('div');
  controls.className = 'pagesquire-inspector-controls';
  const searchLabel = doc.createElement('label');
  searchLabel.textContent = 'Search capabilities';
  const search = doc.createElement('input');
  search.type = 'search';
  search.maxLength = 200;
  search.placeholder = 'ID, description or alias';
  searchLabel.append(search);
  const filterLabel = doc.createElement('label');
  filterLabel.textContent = 'Filter status';
  const filter = doc.createElement('select');
  for (const [value, text] of [
    ['all', 'All statuses'],
    ['issues', 'Needs attention'],
    ['ready', 'Target ready'],
    ['needs_preparation', 'Needs preparation'],
    ['not_checked', 'Not checked'],
    ['blocked_in_alpha', 'Blocked in alpha'],
  ]) {
    const option = doc.createElement('option');
    option.value = value!;
    option.textContent = text!;
    filter.append(option);
  }
  filterLabel.append(filter);
  const refresh = doc.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh checks';
  const show = doc.createElement('button');
  show.type = 'button';
  show.textContent = 'Show diagnostics JSON';
  show.setAttribute('aria-expanded', 'false');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const list = doc.createElement('div');
  list.className = 'pagesquire-inspector-list';
  const diagnostics = doc.createElement('div');
  diagnostics.hidden = true;
  const exportNote = doc.createElement('p');
  exportNote.textContent =
    'Review before sharing: capability IDs, risks and statuses remain. No page text, form values, URLs, schemas or exception details are included. Nothing is uploaded.';
  const exportLabel = doc.createElement('label');
  exportLabel.textContent = 'Diagnostics JSON';
  const output = doc.createElement('textarea');
  output.readOnly = true;
  output.rows = 10;
  output.spellcheck = false;
  exportLabel.append(output);
  diagnostics.append(exportNote, exportLabel);
  controls.append(searchLabel, filterLabel, refresh, show);
  root.append(heading, note, coverage, controls, status, list, diagnostics);
  container.append(root);
  let report = inspector.inspect();

  function renderEntry(entry: CapabilityInspection): HTMLElement {
    const detail = doc.createElement('details');
    detail.dataset.status = entry.status;
    const summary = doc.createElement('summary');
    const id = doc.createElement('code');
    id.textContent = entry.id;
    const badge = doc.createElement('span');
    badge.className = 'pagesquire-inspector-badge';
    badge.textContent = guidance[entry.status][0];
    summary.append(id, badge);
    detail.append(summary);
    detail.addEventListener(
      'toggle',
      () => {
        if (!detail.open || detail.childElementCount > 1) return;
        const body = doc.createElement('div');
        body.className = 'pagesquire-inspector-detail';
        const reason = doc.createElement('p');
        reason.textContent = guidance[entry.status][1];
        body.append(reason);
        if (entry.definition) {
          const definition = entry.definition;
          for (const text of [
            definition.description,
            `Risk: ${definition.risk}. ${entry.expected ? 'Expected by this host.' : 'Registered outside the expected list.'}`,
            `Bindings validated at registration: ${definition.handler} / ${definition.verification.handler} / compiled input schema.`,
            ...(definition.aliases?.length
              ? [`Aliases: ${definition.aliases.join(', ')}`]
              : []),
          ]) {
            const paragraph = doc.createElement('p');
            paragraph.textContent = text;
            body.append(paragraph);
          }
          const label = doc.createElement('p');
          label.textContent =
            'Input schema (metadata only; no values are submitted)';
          const schema = doc.createElement('pre');
          schema.textContent = JSON.stringify(definition.inputSchema, null, 2);
          body.append(label, schema);
        }
        detail.append(body);
      },
      { signal: rows.signal },
    );
    return detail;
  }

  function render() {
    rows.abort();
    rows = new AbortController();
    const query = search.value.slice(0, 200).trim().toLowerCase();
    const visible = report.entries.filter((entry) => {
      const text = [
        entry.id,
        entry.definition?.description ?? '',
        ...(entry.definition?.aliases ?? []),
      ]
        .join(' ')
        .toLowerCase();
      const issue = ![
        'ready',
        'needs_preparation',
        'not_checked',
        'blocked_in_alpha',
      ].includes(entry.status);
      return (
        text.includes(query) &&
        (filter.value === 'all' ||
          (filter.value === 'issues' ? issue : entry.status === filter.value))
      );
    });
    const counts = report.counts;
    coverage.textContent = `${counts.registered} registered · ${counts.missing} expected but missing · ${counts.ready} targets ready · ${counts.needsPreparation} need preparation · ${counts.issues} need attention · ${counts.unchecked} unchecked · ${counts.blocked} blocked`;
    status.textContent = `${visible.length} of ${report.entries.length} capabilities shown. Page scope: ${report.scope}.`;
    list.replaceChildren(...visible.map(renderEntry));
    if (!visible.length) {
      const empty = doc.createElement('p');
      empty.textContent =
        'No matching capabilities. Clear the search or change the status filter.';
      list.append(empty);
    }
    if (!diagnostics.hidden) output.value = inspector.exportDiagnostics();
  }
  search.addEventListener('input', render, { signal: lifetime.signal });
  filter.addEventListener('change', render, { signal: lifetime.signal });
  refresh.addEventListener(
    'click',
    () => {
      report = inspector.inspect();
      render();
    },
    { signal: lifetime.signal },
  );
  show.addEventListener(
    'click',
    () => {
      diagnostics.hidden = !diagnostics.hidden;
      show.setAttribute('aria-expanded', String(!diagnostics.hidden));
      show.textContent = diagnostics.hidden
        ? 'Show diagnostics JSON'
        : 'Hide diagnostics JSON';
      if (!diagnostics.hidden) output.value = inspector.exportDiagnostics();
    },
    { signal: lifetime.signal },
  );
  render();
  return () => {
    lifetime.abort();
    rows.abort();
    root.remove();
  };
}
