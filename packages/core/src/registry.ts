import { validateManifest } from '@pagesquire/protocol';
import type {
  CapabilityDefinition,
  CompiledParameterValidator,
  JsonObject,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import { canonicalJson, immutableCopy } from './json.js';
import type { CapabilityHandler, VerificationHandler } from './types.js';

export interface RegistryBindings {
  handlers: Readonly<Record<string, CapabilityHandler>>;
  verifiers: Readonly<Record<string, VerificationHandler>>;
  parameters: Readonly<Record<string, CompiledParameterValidator>>;
}

export interface RegisteredCapability {
  definition: CapabilityDefinition;
  execute: CapabilityHandler;
  verify: VerificationHandler;
  validate: (value: unknown) => boolean;
}

export class CapabilityRegistry {
  private readonly entries = new Map<string, RegisteredCapability>();

  constructor(manifest: unknown, bindings: RegistryBindings) {
    const safeManifest: unknown = JSON.parse(
      canonicalJson(manifest, 2_000_000),
    );
    const validation = validateManifest(safeManifest);
    if (!validation.valid) {
      throw new PageSquireError(
        'INVALID_MANIFEST',
        validation.errors.join('; '),
      );
    }

    for (const capability of validation.value.capabilities) {
      if (this.entries.has(capability.id)) {
        throw new PageSquireError(
          'DUPLICATE_CAPABILITY',
          `Duplicate capability: ${capability.id}`,
        );
      }
      const execute = Object.hasOwn(bindings.handlers, capability.handler)
        ? bindings.handlers[capability.handler]
        : undefined;
      const verify = Object.hasOwn(
        bindings.verifiers,
        capability.verification.handler,
      )
        ? bindings.verifiers[capability.verification.handler]
        : undefined;
      const parameterValidator = Object.hasOwn(
        bindings.parameters,
        capability.id,
      )
        ? bindings.parameters[capability.id]
        : undefined;
      if (
        typeof execute !== 'function' ||
        typeof verify !== 'function' ||
        !parameterValidator ||
        typeof parameterValidator.validate !== 'function'
      ) {
        throw new PageSquireError(
          'MISSING_BINDING',
          `Missing bindings for ${capability.id}`,
        );
      }
      if (
        canonicalJson(capability.inputSchema) !==
        canonicalJson(parameterValidator.schema)
      ) {
        throw new PageSquireError(
          'SCHEMA_MISMATCH',
          `Recompile parameters for ${capability.id}`,
        );
      }
      this.entries.set(capability.id, {
        definition: immutableCopy(capability),
        execute,
        verify,
        validate: parameterValidator.validate,
      });
    }
  }

  list(): CapabilityDefinition[] {
    return [...this.entries.values()].map((entry) =>
      immutableCopy(entry.definition),
    );
  }

  resolve(id: string, parameters: JsonObject): RegisteredCapability {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new PageSquireError(
        'UNKNOWN_CAPABILITY',
        'The capability is not registered.',
      );
    }
    let valid = false;
    try {
      valid = entry.validate(parameters);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new PageSquireError(
        'INVALID_PARAMETERS',
        'The parameters do not match the capability schema.',
      );
    }
    return entry;
  }
}
