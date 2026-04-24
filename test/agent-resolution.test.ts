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

  it('prefers local team members over global team members', () => {
    writeAgentFile(
      path.join(homeDir, '.pi', 'teams', 'members', 'researcher.md'),
      'Global researcher',
      'You are the global researcher.',
    );
    writeAgentFile(
      path.join(cwdDir, '.pi', 'teams', 'members', 'researcher.md'),
      'Local researcher',
      'You are the local researcher.',
    );

    const file = findAgentFile('researcher', cwdDir);
    expect(file).toBe(path.join(cwdDir, '.pi', 'teams', 'members', 'researcher.md'));
  });

  it('prefers local leaders over local team members with the same name', () => {
    writeAgentFile(
      path.join(cwdDir, '.pi', 'teams', 'leaders', 'reviewer.md'),
      'Local leader reviewer',
      'You are the reviewer leader.',
    );
    writeAgentFile(
      path.join(cwdDir, '.pi', 'teams', 'members', 'reviewer.md'),
      'Local reviewer agent',
      'You are the reviewer agent.',
    );

    const file = findAgentFile('reviewer', cwdDir);
    expect(file).toBe(path.join(cwdDir, '.pi', 'teams', 'leaders', 'reviewer.md'));
  });

  it('getAgentInfo returns description, parsed tools, and extracted system prompt', () => {
    const filePath = path.join(cwdDir, '.pi', 'teams', 'members', 'implementer.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---\nname: implementer\ndescription: Builds features\ntools: read, bash, ask_manager_question\nmodel: claude-haiku-4-5\n---\nYou are an implementation specialist.\nMake careful code changes.\n`,
    );

    const info = getAgentInfo('implementer', cwdDir);
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      name: 'implementer',
      filePath,
      description: 'Builds features',
      tools: ['read', 'bash', 'ask_manager_question'],
      model: 'claude-haiku-4-5',
      systemPrompt: 'You are an implementation specialist.\nMake careful code changes.',
    });
  });

  it('returns the markdown body after frontmatter via getAgentInfo', () => {
    const file = path.join(cwdDir, '.pi', 'teams', 'members', 'prompt-agent.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `---\nname: prompt-agent\ndescription: Finds answers\n---\nYou are a careful researcher.\nFocus on evidence and clear summaries.\n`,
    );

    expect(getAgentInfo('prompt-agent', cwdDir)?.systemPrompt).toBe(
      'You are a careful researcher.\nFocus on evidence and clear summaries.',
    );
  });

  it('returns the whole file when no frontmatter exists via getAgentInfo', () => {
    const file = path.join(cwdDir, '.pi', 'teams', 'members', 'plain-agent.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'You are an implementation agent.');

    expect(getAgentInfo('plain-agent', cwdDir)?.systemPrompt).toBe(
      'You are an implementation agent.',
    );
  });

  it('returns null for unknown agents', () => {
    expect(findAgentFile('missing-agent', cwdDir)).toBeNull();
    expect(getAgentInfo('missing-agent', cwdDir)).toBeNull();
  });
});
