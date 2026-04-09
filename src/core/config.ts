// Configuration utilities for pi-agent

import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Get extension root directory
const __filename = fileURLToPath(import.meta.url);
export const extRoot = dirname(dirname(dirname(__filename)));

// Helper to build paths relative to extRoot
export function extPath(...segments: string[]): string {
  return join(extRoot, ...segments);
}

export interface PiAgentConfig {
  teamsPaths: string[];
  leadersPaths: string[];
  agentsPaths: string[];
  sessionDir: string;
}

// Default configuration with priority order: built-in < global < local
export function getDefaultConfig(): PiAgentConfig {
  const home = process.env.HOME || "";
  const cwd = process.cwd();

  return {
    // Teams: built-in (lowest priority) → global → local (highest priority)
    teamsPaths: [
      extPath("teams"),
      join(home, ".pi", "teams"),
      join(cwd, ".pi", "teams"),
    ],

    // Team leaders
    leadersPaths: [
      extPath("teams", "leaders"),
      join(home, ".pi", "teams", "leaders"),
      join(cwd, ".pi", "teams", "leaders"),
    ],

    // Agent profiles
    agentsPaths: [
      extPath("teams", "leaders"),
      join(home, ".pi", "teams", "members"),
      join(cwd, ".pi", "teams", "members"),
    ],
    // Session storage
    sessionDir: join(home, ".pi", "pi-agent", "sessions"),
  };
}
