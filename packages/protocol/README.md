# @pagesquire/protocol

TypeScript contracts, JSON Schema files, standalone validators and emotion normalization for PageSquire protocol version `0.1`. Validation is compiled during the build, so browser code doesn't need Ajv or `unsafe-eval`.

## Install

```sh
npm install @pagesquire/protocol@beta
```

PageSquire is in beta, so ask for the `beta` tag. Install every PageSquire package at the same version; they depend on each other exactly.

Use `validateManifest`, `validateActionCall`, `validateActionResult`, `validateSnapshot` and `validateAssistantResponse` at your integration boundaries. They check shape, not permission: decode external payloads as JSON and apply your backend's policy before running a capability.

After building, the schema files are exported at paths such as `@pagesquire/protocol/schemas/manifest`. Runtime exports are ES modules.

## App context

`ChatRequest.appContext` is optional. It carries public primitive fields and fixed availability statuses, with its own `schemaVersion: 1`. `validateAppContext` and `validateChatRequest` check structure, unique identities and the 16-KiB limit; the raw JSON Schema alone doesn't enforce every limit. Servers built on the older closed schema reject the field, so deploy the matching server first. See [app context](https://github.com/naufaldenta/pagesquire/blob/main/docs/app-context.md).

MIT licensed.
