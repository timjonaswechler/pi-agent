// Shared configuration utilities

export interface PiAgentConfig {
  teamsPaths: string[];
  leadersPaths: string[];
  agentsPaths: string[];
  sessionDir: string;
}

// Default configuration
export function getDefaultConfig(): PiAgentConfig {
  const home = process.env.HOME || '';
  return {
    teamsPaths: [
      extPath('teams'),                    // Built-in (lowest)
      join(home, '.pi', 'teams'),        // Global
      join(process.cwd(), '.pi', 'teams'), // Local (highest)
    ],
    leadersPaths: [
      extPath('teams', 'leaders'),       // Built-in
      join(home, '.pi', 'teams', 'leaders'),   // Global
      join(process.cwd(), '.pi', 'teams', 'leaders'), // Local
    ],
    agentsPaths: [
      join(process.cwd(), '.pi', 'agents'),   // Local
      join(home, '.pi', 'agents'),            // Global
    ],
    sessionDir: join(home, '.pi', 'pi-agent', 'sessions'),
  };
}
