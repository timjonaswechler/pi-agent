import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import registerExtension from '../src/index.ts';
import * as subagent from '../src/features/sub-agent/index.ts';
import { resetTeamsStateForTests } from '../src/features/teams/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';

describe('command flows with the mock Pi test runtime', () => {
  let tempDir: string;

  beforeEach(() => {
    resetTeamsStateForTests();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-cmd-'));
    fs.mkdirSync(path.join(tempDir, '.pi', 'teams', 'members'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.pi', 'teams', 'members', 'reviewer.md'),
      ['---', 'description: Reviews changes', '---', 'You are a reviewer.', ''].join('\n'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('/agent with no args opens picker and arms the next user message', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });
    ctx.ui.custom = vi.fn(async () => 'reviewer');

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('', ctx);

    expect(ctx.ui.custom).toHaveBeenCalled();
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Delegation armed for reviewer. Enter the task in your next message or run /agent cancel.',
          level: 'info',
        }),
      ]),
    );
  });

  it('armed /agent delegation consumes the next interactive input and spawns a solo subagent', async () => {
    const spawnSpy = vi.spyOn(subagent, 'spawnAndAwait').mockReturnValue({
      sessionId: 'agent-123',
      promise: Promise.resolve({
        sessionId: 'agent-123',
        agent: 'reviewer',
        task: 'Review the auth changes',
        success: true,
        output: 'done',
        elapsedMs: 10,
        pendingQuestions: [],
      }),
    } as any);

    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('reviewer', ctx);

    const [result] = await mock.emit('input', { text: 'Review the auth changes', source: 'interactive' }, ctx);

    expect(result).toEqual({ action: 'handled' });
    expect(spawnSpy).toHaveBeenCalledWith(
      'Review the auth changes',
      expect.objectContaining({
        cwd: tempDir,
        agent: 'reviewer',
        mode: 'manager',
        spawnType: 'solo',
      }),
      expect.any(Function),
    );
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Starting agent 'reviewer'...", level: 'info' }),
        expect.objectContaining({ message: 'Agent started: agent-123', level: 'success' }),
      ]),
    );

    const [secondResult] = await mock.emit('input', { text: 'A second message', source: 'interactive' }, ctx);
    expect(secondResult).toEqual({ action: 'continue' });
  });

  it('armed /agent delegation ignores extension-sourced input until a real user message arrives', async () => {
    const spawnSpy = vi.spyOn(subagent, 'spawnAndAwait').mockReturnValue({
      sessionId: 'agent-123',
      promise: Promise.resolve({
        sessionId: 'agent-123',
        agent: 'reviewer',
        task: 'real task',
        success: true,
        output: 'done',
        elapsedMs: 10,
        pendingQuestions: [],
      }),
    } as any);

    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('reviewer', ctx);

    const [extensionResult] = await mock.emit('input', { text: 'ignore me', source: 'extension' }, ctx);
    expect(extensionResult).toEqual({ action: 'continue' });
    expect(spawnSpy).not.toHaveBeenCalled();

    const [interactiveResult] = await mock.emit('input', { text: 'real task', source: 'interactive' }, ctx);
    expect(interactiveResult).toEqual({ action: 'handled' });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('empty armed /agent task is handled with a warning and does not spawn', async () => {
    const spawnSpy = vi.spyOn(subagent, 'spawnAndAwait');
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('reviewer', ctx);

    const [result] = await mock.emit('input', { text: '   ', source: 'interactive' }, ctx);

    expect(result).toEqual({ action: 'handled' });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Delegation for reviewer cancelled: empty task',
          level: 'warning',
        }),
      ]),
    );
  });

  it('/agent <name> <task> spawns immediately without arming a follow-up message', async () => {
    const spawnSpy = vi.spyOn(subagent, 'spawnAndAwait').mockReturnValue({
      sessionId: 'agent-immediate',
      promise: Promise.resolve({
        sessionId: 'agent-immediate',
        agent: 'reviewer',
        task: 'Review this diff now',
        success: true,
        output: 'done',
        elapsedMs: 10,
        pendingQuestions: [],
      }),
    } as any);

    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('reviewer Review this diff now', ctx);

    expect(spawnSpy).toHaveBeenCalledWith(
      'Review this diff now',
      expect.objectContaining({
        cwd: tempDir,
        agent: 'reviewer',
        mode: 'manager',
        spawnType: 'solo',
      }),
      expect.any(Function),
    );

    const [result] = await mock.emit('input', { text: 'follow-up input', source: 'interactive' }, ctx);
    expect(result).toEqual({ action: 'continue' });
  });

  it('/agent cancel clears pending delegation and reports when nothing is pending', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('agent');
    await command.handler('reviewer', ctx);
    await command.handler('cancel', ctx);
    await command.handler('cancel', ctx);

    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Cancelled pending delegation for reviewer',
          level: 'info',
        }),
        expect.objectContaining({
          message: 'No pending delegation to cancel. To stop a running subagent, use /list and then /kill <session-id>.',
          level: 'info',
        }),
      ]),
    );
  });

  it('/list shows empty-state messaging when no sub-agents are active', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('list');
    await command.handler('', ctx);

    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'No active sub-agents', level: 'info' }),
      ]),
    );
  });

  it('/list shows active sub-agents with status icons', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const stateA = {
      sessionId: 'agent-1',
      subagentId: 'reviewer',
      status: 'running',
      pendingQuestions: [],
      rootSessionId: 'root-test',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    const stateB = {
      sessionId: 'agent-2',
      subagentId: 'clarifier',
      status: 'waiting_manager',
      pendingQuestions: [],
      rootSessionId: 'root-test',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    fs.writeFileSync(path.join(process.env.PI_AGENT_SESSION_DIR!, 'agent-1.json'), JSON.stringify(stateA));
    fs.writeFileSync(path.join(process.env.PI_AGENT_SESSION_DIR!, 'agent-2.json'), JSON.stringify(stateB));

    const command = mock.getCommand('list');
    await command.handler('', ctx);

    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('🟢 reviewer (agent-1) - running'),
        }),
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('🟡 clarifier (agent-2) - waiting_manager'),
        }),
      ]),
    );
  });

  it('/kill with no args and no active sessions shows the empty-state message', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('kill');
    await command.handler('', ctx);

    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'No active sub-agents to kill', level: 'info' }),
      ]),
    );
  });

  it('/kill covers no-arg, success, and failure cases', async () => {
    const killSpy = vi.spyOn(subagent, 'killSubagent')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const activeState = {
      sessionId: 'agent-1',
      subagentId: 'reviewer',
      status: 'running',
      pendingQuestions: [],
      rootSessionId: 'root-test',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    fs.writeFileSync(path.join(process.env.PI_AGENT_SESSION_DIR!, 'agent-1.json'), JSON.stringify(activeState));

    const command = mock.getCommand('kill');
    await command.handler('', ctx);
    await command.handler('agent-1', ctx);
    await command.handler('agent-404', ctx);

    expect(killSpy).toHaveBeenNthCalledWith(1, 'agent-1');
    expect(killSpy).toHaveBeenNthCalledWith(2, 'agent-404');
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Usage: /kill <session-id>', level: 'info' }),
        expect.objectContaining({ message: 'Killed sub-agent: agent-1', level: 'success' }),
        expect.objectContaining({
          message: 'Could not kill agent-404 - not found or already stopped',
          level: 'warning',
        }),
      ]),
    );
  });
});

describe('/team toggle behavior with the mock Pi test runtime', () => {
  let tempDir: string;

  beforeEach(() => {
    resetTeamsStateForTests();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-team-toggle-'));
    fs.mkdirSync(path.join(tempDir, '.pi', 'teams', 'leaders'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.pi', 'teams'), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, '.pi', 'teams', 'teams.yaml'),
      [
        'engineering:',
        '  manager: team-lead',
        '  members:',
        '    - reviewer',
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
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('/team toggles off an active team and clears the team status', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: tempDir });
    ctx.ui.custom = vi.fn(async () => 'engineering');

    registerExtension(mock.pi as any);
    await mock.emit('session_start', { reason: 'startup' }, ctx);

    const command = mock.getCommand('team');
    await command.handler('', ctx);
    await command.handler('', ctx);

    expect(ctx.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'team', value: 'Team: engineering' }),
        expect.objectContaining({ key: 'team', value: undefined }),
      ]),
    );
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Team Mode activated: engineering', level: 'success' }),
        expect.objectContaining({ message: 'Team Mode deactivated', level: 'info' }),
      ]),
    );
  });
});
