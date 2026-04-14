import path from 'path';
import { expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { killSubagent, spawnAndAwait } from '../src/features/sub-agent/index.ts';
import { describeIntegration, waitFor } from './helpers/integration.ts';

describeIntegration('subprocess failure integration', () => {
  it('times out a slow subagent cleanly and removes its session state', async () => {
    const cwd = path.resolve('.');

    const { sessionId, promise } = spawnAndAwait(
      'Exercise the timeout path.',
      {
        cwd,
        agent: 'slow-debug-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 2000,
      },
    );

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timed out after 2000ms');
    expect(result.pendingQuestions).toEqual([]);
    expect(session.readSession(sessionId)).toBeNull();
  }, 15000);

  it('surfaces a subprocess spawn error cleanly and removes its session state', async () => {
    const cwd = path.join(path.resolve('.'), 'definitely-missing-cwd');

    const { sessionId, promise } = spawnAndAwait(
      'Exercise the process-error path.',
      {
        cwd,
        agent: 'crash-debug-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 10000,
      },
    );

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain('enoent');
    expect(result.pendingQuestions).toEqual([]);
    expect(session.readSession(sessionId)).toBeNull();
  }, 15000);

  it('kills a slow-running subagent without affecting a successful sibling', async () => {
    const cwd = path.resolve('.');

    const slow = spawnAndAwait(
      'Exercise the manual kill path.',
      {
        cwd,
        agent: 'slow-debug-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 30000,
      },
    );
    const happy = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      {
        cwd,
        agent: 'happy-path-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 30000,
      },
    );

    await waitFor(() => {
      const state = session.readSession(slow.sessionId);
      return state?.status === 'running' ? state : null;
    }, 15000);

    expect(killSubagent(slow.sessionId)).toBe(true);
    expect(killSubagent(slow.sessionId)).toBe(false);

    const [slowResult, happyResult] = await Promise.all([slow.promise, happy.promise]);

    expect(slowResult.success).toBe(false);
    expect(slowResult.error).toContain('Timed out after 30000ms');
    expect(happyResult.success).toBe(true);
    expect(happyResult.output).toContain('HAPPY_PATH_OK');

    expect(session.readSession(slow.sessionId)).toBeNull();
    expect(session.readSession(happy.sessionId)).toBeNull();
  }, 40000);
});
