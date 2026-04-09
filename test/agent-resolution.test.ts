import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findAgentFile, getAgentInfo } from '../src/features/sub-agent/index.ts';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAgentFile(filePath: string, description: string, body: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `---\nname: test-agent\ndescription: ${description}\n---\n${body}\n`,
  );
}

describe('agent resolution', () => {
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

  it('prefers local leaders over global leaders', () => {
    writeAgentFile(
      path.join(homeDir, '.pi', 'teams', 'leaders', 'lead.md'),
      'Global leader',
      'You are the global leader.',
    );
    writeAgentFile(
      path.join(cwdDir, '.pi', 'teams', 'leaders', 'lead.md'),
      'Local leader',
      'You are the local leader.',
    );

    const file = findAgentFile('lead', cwdDir);
    expect(file).toBe(path.join(cwdDir, '.pi', 'teams', 'leaders', 'lead.md'));
  });

  it('prefers local agents over global agents', () => {
    writeAgentFile(
      path.join(homeDir, '.pi', 'agents', 'researcher.md'),
      'Global researcher',
      'You are the global researcher.',
    );
    writeAgentFile(
      path.join(cwdDir, '.pi', 'agents', 'researcher.md'),
      'Local researcher',
      'You are the local researcher.',
    );

    const file = findAgentFile('researcher', cwdDir);
    expect(file).toBe(path.join(cwdDir, '.pi', 'agents', 'researcher.md'));
  });

  it('prefers local leaders over local agents with the same name', () => {
    writeAgentFile(
      path.join(cwdDir, '.pi', 'teams', 'leaders', 'reviewer.md'),
      'Local leader reviewer',
      'You are the reviewer leader.',
    );
    writeAgentFile(
      path.join(cwdDir, '.pi', 'agents', 'reviewer.md'),
      'Local reviewer agent',
      'You are the reviewer agent.',
    );

    const file = findAgentFile('reviewer', cwdDir);
    expect(file).toBe(path.join(cwdDir, '.pi', 'teams', 'leaders', 'reviewer.md'));
  });

  it('getAgentInfo returns description and extracted system prompt', () => {
    const filePath = path.join(cwdDir, '.pi', 'agents', 'implementer.md');
    writeAgentFile(
      filePath,
      'Builds features',
      'You are an implementation specialist.\nMake careful code changes.',
    );

    const info = getAgentInfo('implementer', cwdDir);
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      name: 'implementer',
      filePath,
      description: 'Builds features',
      systemPrompt: 'You are an implementation specialist.\nMake careful code changes.',
    });
  });

  it('returns null for unknown agents', () => {
    expect(findAgentFile('missing-agent', cwdDir)).toBeNull();
    expect(getAgentInfo('missing-agent', cwdDir)).toBeNull();
  });
});
