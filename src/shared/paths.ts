// Shared path utilities for pi-agent
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get extension root directory
const __filename = fileURLToPath(import.meta.url);
export const extRoot = dirname(dirname(dirname(__filename)));

// Helper to build paths relative to extRoot
export function extPath(...segments: string[]): string {
  return join(extRoot, ...segments);
}
