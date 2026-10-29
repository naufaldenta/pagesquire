## What and why

What changes for users, which packages are affected, and the related issue if there is one.

## Testing

- Commands run and results:
- Framework, runtime and browser versions used:
- Not tested:

## Checklist

- [ ] Tests cover success, denial or failure, and stale, ambiguous or cancelled cases where relevant.
- [ ] New actions are registered and verified by checking the page, not by UI text.
- [ ] Server authorization, CSRF, origin and budget checks still apply; no secrets or user data are included.
- [ ] Docs and comments are in English, and new compatibility claims have a fixture.
- [ ] Version, schema and migration changes are documented.
- [ ] Licenses, third-party notices and corresponding sources are kept intact.
- [ ] Affected tests, formatting and `npm run release:check` pass, or the PR says which were not run.
