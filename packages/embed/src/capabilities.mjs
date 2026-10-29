import {
  createGenericCapabilities,
  createLinkCapabilities,
  createScreenshotCapabilities,
  createPageCapabilities,
  navigationCapability,
} from '@pagesquire/core';

/**
 * The fixed catalog of the one-tag embed. Load this same manifest
 * (dist/manifest.json) into your server engine so both sides agree.
 */
export const manifest = {
  schemaVersion: '0.1',
  capabilities: [
    ...createPageCapabilities(['content']),
    navigationCapability,
    // Offered only when the tag sets data-generic="true".
    ...createGenericCapabilities(),
    // Offered only with data-companion and data-screenshots as well.
    ...createScreenshotCapabilities(),
    // Offered only when the tag sets data-link="true" (PageSquire Link).
    ...createLinkCapabilities(),
  ],
};
