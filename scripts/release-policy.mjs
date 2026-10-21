import { distributionPathAllowed } from './distribution-sources.mjs';

const number = '(?:0|[1-9][0-9]*)';
const prerelease = new RegExp(
  `^0\\.${number}\\.${number}-(alpha|beta)\\.${number}$`,
);

/** Reviewed development channels only; neither stable, RC nor build aliases. */
export function prereleaseChannel(version) {
  if (typeof version !== 'string') return null;
  const match = prerelease.exec(version);
  return match ? `github-${match[1]}` : null;
}

export const betaRequirementIds = Object.freeze([
  'externalOnboarding',
  'supportScopeReviewed',
  'securityOperationsReviewed',
]);

/** Validate operator records, not the truth of independent or remote reviews. */
export function assessBetaPolicy(policy, files) {
  const errors = [];
  const isObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !isObject(policy) ||
    Object.keys(policy).length !== betaRequirementIds.length ||
    Object.keys(policy).some((key) => !betaRequirementIds.includes(key))
  )
    errors.push(
      'Beta policy must declare exactly the three review requirements.',
    );
  const requirements = betaRequirementIds.map((id) => {
    const item = policy?.[id];
    const evidence = item?.evidence;
    const valid =
      isObject(item) &&
      Object.keys(item).length === 2 &&
      Object.hasOwn(item, 'approved') &&
      Object.hasOwn(item, 'evidence') &&
      typeof item.approved === 'boolean' &&
      Array.isArray(evidence) &&
      evidence.length <= 8 &&
      new Set(evidence).size === evidence.length &&
      evidence.every(
        (reference) =>
          typeof reference === 'string' &&
          reference.length <= 200 &&
          reference.startsWith('docs/') &&
          reference.endsWith('.md') &&
          distributionPathAllowed(reference) &&
          !reference.includes('\\') &&
          files.has(reference),
      ) &&
      (!item.approved || evidence.length > 0);
    if (!valid)
      errors.push(
        `Invalid beta review record: ${id}; use explicit approval and existing sanitized guide references.`,
      );
    return { id, approved: valid && item.approved === true };
  });
  return {
    errors,
    requirements,
    gates: requirements
      .filter((item) => !item.approved)
      .map((item) => `beta.${item.id}`),
  };
}
