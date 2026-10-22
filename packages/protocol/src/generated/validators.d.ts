interface GeneratedValidator {
  (value: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

export const capability: GeneratedValidator;
export const manifest: GeneratedValidator;
export const actionCall: GeneratedValidator;
export const response: GeneratedValidator;
export const snapshot: GeneratedValidator;
export const actionResult: GeneratedValidator;
export const chatRequest: GeneratedValidator;
export const appContext: GeneratedValidator;
export const chatReply: GeneratedValidator;
export const providerResponse: GeneratedValidator;
