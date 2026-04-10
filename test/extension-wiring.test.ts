import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import registerExtension from '../src/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';

describe('extension wiring with the mock Pi test runtime', () => {
  const originalForcedTools = process.env.PI_AGENT_ACTIVE_TOOLS;

  beforeEach(() => {
    delete process.env.PI_AGENT_ACTIVE_TOOLS;
  });

  afterEach(() => {
    if (originalForcedTools === undefined) {
      delete process.env.PI_AGENT_ACTIVE_TOOLS;
    } else {
      process.env.PI_AGENT_ACTIVE_TOOLS = originalForcedTools;
    }
  });

  it('registers the expected commands and tools', () => {
    const mock = createMockPi();

    registerExtension(mock.pi as any);

    expect(Array.from(mock.commands.keys()).sort()).toEqual(['agent', 'kill', 'list', 'team']);
    expect(Array.from(mock.tools.keys()).sort()).toEqual([
      'answer_manager_question',
      'ask_manager_question',
      'ask_user_question',
      'get_pending_questions',
      'run_subagents',
    ]);
    expect(mock.getHandlers('session_start')).toHaveLength(2);
    expect(mock.getHandlers('context')).toHaveLength(1);
    expect(mock.getHandlers('input')).toHaveLength(1);
  });

  it('applies forced active tools and shows the startup notification on session_start', async () => {
    process.env.PI_AGENT_ACTIVE_TOOLS = 'read,bash,ask_manager_question';
    const mock = createMockPi();
    const ctx = createMockCtx();

    registerExtension(mock.pi as any);

    await mock.emit('session_start', { reason: 'startup' }, ctx);

    expect(mock.getActiveTools()).toEqual(['read', 'bash', 'ask_manager_question']);
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'pi-agent loaded — /agent  /team  /list  /kill',
          level: 'info',
        }),
      ]),
    );
  });

  it('filters agent-result messages from context history', async () => {
    const mock = createMockPi();
    registerExtension(mock.pi as any);

    const [result] = await mock.emit('context', {
      messages: [
        { role: 'assistant', customType: 'agent-result', content: 'hidden' },
        { role: 'assistant', customType: 'team-mode-context', content: 'keep' },
        { role: 'user', content: 'visible' },
      ],
    });

    expect(result).toEqual({
      messages: [
        { role: 'assistant', customType: 'team-mode-context', content: 'keep' },
        { role: 'user', content: 'visible' },
      ],
    });
  });
});

describe('/team command wiring', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-team-'));
    fs.mkdirSync(path.join(tempDir, '.pi', 'teams', 'leaders'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.pi', 'teams'), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, '.pi', 'teams', 'teams.yaml'),
      [
        'engineering:',
        '  manager: team-lead',
        '  members:',
        '    - clarification-tester',
        '  description: Engineering team',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      path.join(tempDir, '.pi', 'teams', 'leaders', 'team-lead.md'),
      [
        '---',
        'description: Team lead',
        '---',
        'You are manager of {TEAM_NAME}.',
        'Members:',
        '{MEMBERS_LIST}',
        'Names: {MEMBER_NAMES}',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('injects hidden team context with nextTurn delivery and updates status', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });
    ctx.ui.custom = async () => 'engineering';

    registerExtension(mock.pi as any);
    const teamCommand = mock.getCommand('team');

    await teamCommand.handler('', ctx);

    expect(mock.sentMessages).toHaveLength(1);
    expect(mock.sentMessages[0]).toMatchObject({
      message: {
        customType: 'team-mode-context',
        display: false,
        details: {
          teamName: 'engineering',
          manager: 'team-lead',
          members: ['clarification-tester'],
        },
      },
      options: {
        deliverAs: 'nextTurn',
      },
    });
    expect(mock.sentMessages[0]?.message.content).toContain('You are manager of engineering.');
    expect(mock.sentMessages[0]?.message.content).toContain('Names: clarification-tester');
    expect(ctx.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'team', value: 'Team: engineering' }),
      ]),
    );
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Team Mode activated: engineering', level: 'success' }),
      ]),
    );
  });
});
