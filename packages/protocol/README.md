# @pagesquire/protocol

Private development preview of PageSquire protocol version `0.1`.

C3 adds optional `ChatRequest.appContext` (envelope schema1), public primitive fields and fixed availability statuses. `validateAppContext` and `validateChatRequest` enforce both structural checks and unique identities / 16-KiB limits; raw JSON Schema alone does not enforce all semantic limits. Old closed-schema servers reject the opted-in field; deploy matching artifacts first. See [context/compatibility](../../docs/app-context.md).

Exports TypeScript contracts, JSON Schema artifacts, standalone validators, and emotion normalization. JSON Schema validation is compiled during the workspace build; browser consumers do not need Ajv or unsafe-eval.

Use `validateManifest`, `validateActionCall`, `validateActionResult`, `validateSnapshot`, and `validateAssistantResponse` at integration boundaries. These are schema checks, not authorization decisions. Decode external payloads as JSON and apply backend policy before invoking capabilities.

JSON Schema files are available through exports such as `@pagesquire/protocol/schemas/manifest` after building. Runtime exports use ES modules.

No package has been published. See the workspace documentation for the current implementation scope and MIT license.
