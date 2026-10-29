import type { CapabilityDefinition } from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import type { CapabilityHandler, VerificationHandler } from './types.js';

/**
 * PageSquire Link (Phase 6B): the built-in tool that hands the visitor to a
 * partner site. Add it to the manifest only when the server runs the engine
 * with `links`; the engine offers it only while an active link allows a
 * partner skill, checks every proposal, and sends nothing to the partner
 * until the visitor approves in the browser.
 */
export function createLinkCapabilities(): CapabilityDefinition[] {
  return [
    {
      id: 'link.handoff',
      description:
        "Hand the visitor to a partner site for one of the partner skills listed in partnerSkills, when that is what they want and this site cannot do it. Give the skill value as listed, a one-line goal in the visitor's own words, and only fields the visitor stated. The visitor sees the partner, the goal and every field and must approve; the partner then opens in a new tab.",
      execution: 'browser',
      handler: 'link.handoff',
      inputSchema: {
        type: 'object',
        properties: {
          skill: { type: 'string', minLength: 3, maxLength: 200 },
          goal: { type: 'string', minLength: 1, maxLength: 300 },
          fields: {
            type: 'object',
            maxProperties: 10,
            additionalProperties: {
              anyOf: [
                { type: 'string', maxLength: 200 },
                { type: 'number' },
                { type: 'boolean' },
              ],
            },
          },
          // Set by the engine from the link, never by the model.
          partner: {
            type: 'object',
            properties: {
              origin: { type: 'string', maxLength: 200 },
              name: { type: 'string', maxLength: 80 },
            },
            required: ['origin', 'name'],
            additionalProperties: false,
          },
        },
        required: ['skill', 'goal'],
        additionalProperties: false,
      },
      risk: 'reversible',
      verification: { handler: 'link.handoff.verify' },
    },
  ];
}

export interface LinkBindingOptions {
  /**
   * Reports the visitor's approval of a pending link.handoff call to the
   * server and returns the partner URL (AssistantClient.approveHandoff).
   */
  approve: (callId: string, signal: AbortSignal) => Promise<string>;
  /** Opens the new tab; defaults to window.open in the page's window. */
  open?: () => Window | null;
}

/**
 * The browser side of link.handoff: the visitor sees the partner, the goal
 * and every field and must choose Continue. The new tab opens at once, while
 * the click still counts as a user gesture; only then does the server send
 * the ticket, and the tab goes to the partner's address with its code.
 */
export function createLinkBindings(options: LinkBindingOptions): {
  capabilities: CapabilityDefinition[];
  handlers: Record<string, CapabilityHandler>;
  verifiers: Record<string, VerificationHandler>;
} {
  const opened = new Map<string, string>();
  const handlers: Record<string, CapabilityHandler> = {
    'link.handoff': async (parameters, context) => {
      const partner = parameters.partner as
        { origin?: unknown; name?: unknown } | undefined;
      if (
        typeof partner?.origin !== 'string' ||
        typeof partner.name !== 'string' ||
        !/^https?:\/\/[^/?#\s]+$/.test(partner.origin)
      )
        throw new PageSquireError(
          'INVALID_PARAMETERS',
          'The handoff does not name its partner site.',
        );
      if (!context.askVisitor)
        throw new PageSquireError(
          'VISITOR_UNAVAILABLE',
          'No visitor prompt is configured on this page.',
        );
      try {
        await context.askVisitor({
          kind: 'link',
          partner: { origin: partner.origin, name: partner.name },
          goal: String(parameters.goal),
          fields: { ...((parameters.fields ?? {}) as Record<string, string>) },
        });
      } catch (error) {
        // Choosing not to continue is the visitor's decision, not a failure.
        if (
          error instanceof PageSquireError &&
          error.code === 'VISITOR_DECLINED'
        )
          throw new PageSquireError(
            'CANCELLED',
            'The visitor chose not to continue on the partner site.',
          );
        throw error;
      }
      const tab = options.open
        ? options.open()
        : (context.document.defaultView?.open('', '_blank') ?? null);
      if (!tab)
        throw new PageSquireError(
          'POPUP_BLOCKED',
          'The browser blocked the new tab. Allow pop-ups for this site and try again.',
        );
      try {
        // The partner page never gets a handle on this one.
        tab.opener = null;
      } catch {
        /* Some browsers make opener read-only; the tab is still ours. */
      }
      let target: URL;
      try {
        target = new URL(
          await options.approve(context.call.callId, context.signal),
        );
      } catch (error) {
        tab.close();
        throw error;
      }
      if (
        target.origin !== partner.origin ||
        !/^#psq-link=[A-Za-z0-9_-]{22}$/.test(target.hash)
      ) {
        tab.close();
        throw new PageSquireError(
          'PARTNER_INVALID',
          'The partner address does not match the approved site.',
        );
      }
      tab.location.href = target.href;
      opened.set(context.call.callId, partner.origin);
    },
  };
  const verifiers: Record<string, VerificationHandler> = {
    'link.handoff.verify': (_parameters, context) => {
      const origin = opened.get(context.call.callId);
      opened.delete(context.call.callId);
      return origin
        ? { verified: true, evidence: { opened: origin } }
        : { verified: false };
    },
  };
  return { capabilities: createLinkCapabilities(), handlers, verifiers };
}
