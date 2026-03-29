'use client';

import {initializeWebModelContext} from '@mcp-b/global';

// Initialize on module load (client-side only).
// This must run before any component calls navigator.modelContext.registerTool().
if (typeof window !== 'undefined') {
  initializeWebModelContext();
}

/**
 * Dummy component to ensure this module is included in the client bundle.
 * The actual initialization happens at module scope above.
 */
export default function WebMCPInit() {
  return null;
}
