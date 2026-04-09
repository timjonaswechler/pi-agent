import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractSystemPrompt } from '../src/features/sub-agent/index.ts';

describe('extractSystemPrompt', () => {
  it('returns the markdown body after frontmatter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-prompt-'));
    const file = path.join(dir, 'agent.md');

    fs.writeFileSync(
      file,
      `---\nname: researcher\ndescription: Finds answers\n---\nYou are a careful researcher.\nFocus on evidence and clear summaries.\n`,
    );

    expect(extractSystemPrompt(file)).toBe(
      'You are a careful researcher.\nFocus on evidence and clear summaries.',
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the whole file when no frontmatter exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-prompt-'));
    const file = path.join(dir, 'agent.md');

    fs.writeFileSync(file, 'You are an implementation agent.');

    expect(extractSystemPrompt(file)).toBe('You are an implementation agent.');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
