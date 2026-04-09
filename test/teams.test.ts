import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadTeamsYaml } from '../src/features/teams/index.ts';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('loadTeamsYaml', () => {
  const originalHome = process.env.HOME;
  let homeDir: string;
  let cwdDir: string;

  beforeEach(() => {
    homeDir = makeTempDir('pi-agent-home-');
    cwdDir = makeTempDir('pi-agent-cwd-');
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  });

  it('loads built-in teams when no local or global teams.yaml exists', () => {
    const teams = loadTeamsYaml(cwdDir);
    expect(teams).not.toBeNull();
    expect(teams).toHaveProperty('Default-Team');
    expect(teams).toHaveProperty('Coding-Team');
  });

  it('loads a valid local teams.yaml', () => {
    const teamsDir = path.join(cwdDir, '.pi', 'teams');
    fs.mkdirSync(teamsDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamsDir, 'teams.yaml'),
      `engineering:\n  manager: leaders/team-leader\n  members:\n    - researcher\n    - implementer\n  description: Core engineering team\n`,
    );

    const teams = loadTeamsYaml(cwdDir);
    expect(teams).not.toBeNull();
    expect(teams).toMatchObject({
      engineering: {
        manager: 'leaders/team-leader',
        members: ['researcher', 'implementer'],
        description: 'Core engineering team',
      },
    });
  });

  it('prefers local teams over global teams for the same name', () => {
    const globalTeamsDir = path.join(homeDir, '.pi', 'teams');
    const localTeamsDir = path.join(cwdDir, '.pi', 'teams');
    fs.mkdirSync(globalTeamsDir, { recursive: true });
    fs.mkdirSync(localTeamsDir, { recursive: true });

    fs.writeFileSync(
      path.join(globalTeamsDir, 'teams.yaml'),
      `engineering:\n  manager: global-leader\n  members:\n    - global-researcher\nplatform:\n  manager: platform-leader\n  members:\n    - infra\n`,
    );

    fs.writeFileSync(
      path.join(localTeamsDir, 'teams.yaml'),
      `engineering:\n  manager: local-leader\n  members:\n    - local-researcher\n    - local-reviewer\n`,
    );

    const teams = loadTeamsYaml(cwdDir);
    expect(teams).not.toBeNull();
    expect(teams).toMatchObject({
      engineering: {
        manager: 'local-leader',
        members: ['local-researcher', 'local-reviewer'],
      },
      platform: {
        manager: 'platform-leader',
        members: ['infra'],
      },
    });
  });

  it('throws an actionable error for invalid team config', () => {
    const teamsDir = path.join(cwdDir, '.pi', 'teams');
    fs.mkdirSync(teamsDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamsDir, 'teams.yaml'),
      `engineering:\n  members:\n    - researcher\n`,
    );

    expect(() => loadTeamsYaml(cwdDir)).toThrow("Invalid team config for 'engineering': missing manager");
  });
});
