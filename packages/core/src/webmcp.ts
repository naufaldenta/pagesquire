import { PROTOCOL_VERSION } from '@pagesquire/protocol';
import type {
  ActionResult,
  CapabilityDefinition,
  JsonObject,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import type { BrowserRuntime } from './runtime.js';
import type { ActionProgressListener } from './types.js';

/** The subset of the WebMCP `document.modelContext` API this bridge uses. */
export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> | unknown;
}

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonObject;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
    consequentialHint: boolean;
  };
  execute(
    input: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<WebMcpToolResult>;
}

/** What an agent receives: the verified outcome, never page text or host errors. */
export interface WebMcpToolResult {
  status: ActionResult['status'];
  code: string;
  message: string;
  evidence: JsonObject;
}

export interface WebMcpOptions {
  /** Defaults to `document.modelContext`; the bridge is a no-op when it is absent. */
  modelContext?: WebMcpModelContext;
  /**
   * Narrows the exposed capabilities. Consequential capabilities are exposed
   * only when the runtime has an approval prompt, which still asks the person.
   */
  include?: (definition: CapabilityDefinition) => boolean;
  /** Unregisters every tool when aborted. */
  signal?: AbortSignal;
  onActionProgress?: ActionProgressListener;
}

export interface WebMcpRegistration {
  /** Capability IDs the browser accepted as WebMCP tools. */
  registered: string[];
  /** Capability IDs the browser refused, e.g. a name another script already uses. */
  rejected: string[];
  dispose(): void;
}

/**
 * Exposes registered capabilities as WebMCP tools so browser-integrated agents
 * can call them. Every call goes through the same runtime as the PageSquire
 * widget: fresh observation, schema validation, one action at a time,
 * cancellation, timeouts and the registered postcondition verifier.
 */
export async function exposeToWebMcp(
  runtime: BrowserRuntime,
  options: WebMcpOptions = {},
): Promise<WebMcpRegistration> {
  const document = runtime.observer.document;
  const modelContext =
    options.modelContext ??
    (document as Document & { modelContext?: WebMcpModelContext }).modelContext;
  const controller = new AbortController();
  const dispose = () => controller.abort();
  const registration: WebMcpRegistration = {
    registered: [],
    rejected: [],
    dispose,
  };
  if (!modelContext || typeof modelContext.registerTool !== 'function')
    return registration;
  if (options.signal?.aborted) return registration;
  options.signal?.addEventListener('abort', dispose, { once: true });
  const crypto = document.defaultView?.crypto ?? globalThis.crypto;
  for (const definition of runtime.registry.list()) {
    const consequential = definition.risk === 'consequential';
    if (consequential && !runtime.approvalEnabled) continue;
    try {
      if (options.include && !options.include(definition)) continue;
    } catch {
      continue;
    }
    const tool: WebMcpTool = {
      name: definition.id,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: {
        readOnlyHint: definition.risk === 'read_only',
        untrustedContentHint: true,
        consequentialHint: consequential,
      },
      execute: async (input, execution = {}) => {
        let snapshotId: string;
        try {
          snapshotId = runtime.observe().id;
        } catch (error) {
          return failure(error);
        }
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const result = await runtime.execute(
          {
            protocolVersion: PROTOCOL_VERSION,
            callId: `webmcp-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
            capabilityId: definition.id,
            snapshotId,
            parameters: input,
          },
          {
            ...(execution.signal ? { signal: execution.signal } : {}),
            ...(options.onActionProgress
              ? { onActionProgress: options.onActionProgress }
              : {}),
          },
        );
        return {
          status: result.status,
          code: result.code,
          message: result.message,
          evidence: result.evidence,
        };
      },
    };
    try {
      await modelContext.registerTool(tool, { signal: controller.signal });
      registration.registered.push(definition.id);
    } catch {
      registration.rejected.push(definition.id);
    }
  }
  return registration;
}

function failure(error: unknown): WebMcpToolResult {
  const known = error instanceof PageSquireError;
  return {
    status: 'failed',
    code: known ? error.code : 'OBSERVATION_FAILED',
    message: known
      ? error.message
      : 'The page could not be observed for this action.',
    evidence: {},
  };
}
