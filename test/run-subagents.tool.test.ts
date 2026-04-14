import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import registerExtension from '../src/index.ts';
import * as subagent from '../src/features/sub-agent/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';

describe('run_subagents tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fans out tasks in parallel and aggregates results in input order', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    registerExtension(mock.pi as any);

    const spawnSpy = vi.spyOn(subagent, 'spawnAndAwait')
      .mockImplementationOnce((task, options, onProgress) => {
        onProgress?.('[researcher] started');
        return {
          sessionId: 'agent-a',
          promise: new Promise((resolve) =>
            setTimeout(
              () => resolve({
                sessionId: 'agent-a',
                agent: options.agent || 'default',
                task,
                success: true,
                output: 'Result A',
                elapsedMs: 50,
                pendingQuestions: [],
              }),
              30,
            ),
          ),
        } as any;
      })
      .mockImplementationOnce((task, options, onProgress) => {
        onProgress?.('[implementer] started');
        return {
          sessionId: 'agent-b',
          promise: new Promise((resolve) =>
            setTimeout(
              () => resolve({
                sessionId: 'agent-b',
                agent: options.agent || 'default',
                task,
                success: true,
                output: 'Result B',
                elapsedMs: 10,
                pendingQuestions: [],
              }),
              5,
            ),
          ),
        } as any;
      });

    const updates: string[] = [];
    const tool = mock.getTool('run_subagents');
    const result = await tool.execute(
      'tool-call-run-1',
      {
        tasks: [
          { description: 'Research the codebase', agent: 'researcher' },
          { description: 'Implement the patch', agent: 'implementer' },
        ],
        timeoutSeconds: 42,
      },
      undefined,
      (update: any) => {
        const text = update?.content?.map((c: any) => c.text).join('\n');
        if (text) updates.push(text);
      },
      ctx,
    );

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(spawnSpy).toHaveBeenNthCalledWith(
      1,
      'Research the codebase',
      expect.objectContaining({
        cwd: '/tmp/project',
        agent: 'researcher',
        mode: 'manager',
        spawnType: 'team',
        timeoutMs: 42000,
      }),
      expect.any(Function),
    );
    expect(spawnSpy).toHaveBeenNthCalledWith(
      2,
      'Implement the patch',
      expect.objectContaining({
        cwd: '/tmp/project',
        agent: 'implementer',
        mode: 'manager',
        spawnType: 'team',
        timeoutMs: 42000,
      }),
      expect.any(Function),
    );

    expect(updates[0]).toContain('Spawning 2 sub-agent(s)...');
    expect(updates.some((u) => u.includes('[researcher] started'))).toBe(true);
    expect(updates.some((u) => u.includes('[implementer] started'))).toBe(true);

    expect(result.details.allSuccess).toBe(true);
    expect(result.details.results).toHaveLength(2);
    expect(result.details.results[0]).toMatchObject({ sessionId: 'agent-a', output: 'Result A' });
    expect(result.details.results[1]).toMatchObject({ sessionId: 'agent-b', output: 'Result B' });

    const text = result.content[0]?.text ?? '';
    expect(text.indexOf('### Task 1 (researcher)')).toBeLessThan(text.indexOf('### Task 2 (implementer)'));
    expect(text).toContain('Result A');
    expect(text).toContain('Result B');
  });

  it('isolates failures and surfaces pending questions without corrupting successful results', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    registerExtension(mock.pi as any);

    vi.spyOn(subagent, 'spawnAndAwait')
      .mockImplementationOnce((task, options) => ({
        sessionId: 'agent-success',
        promise: Promise.resolve({
          sessionId: 'agent-success',
          agent: options.agent || 'default',
          task,
          success: true,
          output: 'Success output',
          elapsedMs: 12,
          pendingQuestions: [],
        }),
      } as any))
      .mockImplementationOnce((task, options) => ({
        sessionId: 'agent-timeout',
        promise: Promise.resolve({
          sessionId: 'agent-timeout',
          agent: options.agent || 'default',
          task,
          success: false,
          output: '',
          error: 'Timed out after 5000ms',
          elapsedMs: 5000,
          pendingQuestions: [
            { questionId: 'q-1', question: 'Need one answer before continuing.' },
          ],
        }),
      } as any));

    const tool = mock.getTool('run_subagents');
    const result = await tool.execute(
      'tool-call-run-2',
      {
        tasks: [
          { description: 'Do the safe task', agent: 'success-agent' },
          { description: 'Do the blocked task', agent: 'blocked-agent' },
        ],
        timeoutSeconds: 5,
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details.allSuccess).toBe(false);
    expect(result.details.results).toHaveLength(2);
    expect(result.details.results[0]).toMatchObject({ success: true, output: 'Success output' });
    expect(result.details.results[1]).toMatchObject({ success: false, error: 'Timed out after 5000ms' });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Success output');
    expect(text).toContain('**Error:** Timed out after 5000ms');
    expect(text).toContain('**⚠️ Unanswered questions from this sub-agent:**');
    expect(text).toContain('[q-1] Need one answer before continuing.');
    expect(text).toContain('Re-run with more context or answer via answer_manager_question.');
  });
});
