import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
// src/shared/paths.ts → src/shared/ → src/ → extension root
const extRoot = dirname(dirname(dirname(__filename)));

export function getExtensionRoot(): string {
  return extRoot;
}

export function getBuiltInTeamsRoot(): string {
  return process.env.PI_AGENT_BUILTIN_TEAMS_DIR || join(extRoot, 'teams');
}

export function getTeamsYamlSearchPaths(cwd: string): Array<{ path: string; priority: number }> {
  const home = process.env.HOME || '';
  return [
    { path: join(getBuiltInTeamsRoot(), 'teams.yaml'), priority: 1 },
    { path: join(home, '.pi', 'teams', 'teams.yaml'), priority: 2 },
    { path: join(cwd, '.pi', 'teams', 'teams.yaml'), priority: 3 },
  ];
}

export function getMemberDirSearchPaths(cwd: string): string[] {
  const home = process.env.HOME || '';
  return [
    join(cwd, '.pi', 'teams', 'members'),
    join(home, '.pi', 'teams', 'members'),
    join(getBuiltInTeamsRoot(), 'members'),
  ];
}

export function getLeaderDirSearchPaths(cwd: string): string[] {
  const home = process.env.HOME || '';
  return [
    join(cwd, '.pi', 'teams', 'leaders'),
    join(home, '.pi', 'teams', 'leaders'),
    join(getBuiltInTeamsRoot(), 'leaders'),
  ];
}
