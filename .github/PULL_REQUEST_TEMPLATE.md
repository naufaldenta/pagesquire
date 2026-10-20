## Change and reason

Describe the user-visible outcome, affected packages and relevant issue (if one exists).

## Verification

- Commands and actual results:
- Exact framework/runtime/browser versions exercised:
- Targets not tested:

## Review checklist

- [ ] Regression tests cover success, denial/failure and relevant stale/ambiguous/cancellation cases.
- [ ] Actions are explicitly registered and have real postcondition verification; UI text alone does not establish success.
- [ ] Server authorization/CSRF/origin/budget controls remain enforced; secrets and user data are absent.
- [ ] Canonical docs/comments/generated guidance are English and compatibility claims have fixture evidence.
- [ ] Version/schema changes and migration implications are documented where applicable.
- [ ] Dependency/asset rights and MIT/GPL/third-party notices/corresponding sources are preserved.
- [ ] Affected tests, formatting and `npm run release:check` passed; unrun checks are stated honestly.
- [ ] No registry publication, production deployment or dangerous action is included without explicit owner review.
