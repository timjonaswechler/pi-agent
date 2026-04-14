import path from 'path';
import { expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { spawnAndAwait } from '../src/features/sub-agent/index.ts';
import { describeIntegration } from './helpers/integration.ts';

describeIntegration('subprocess happy path integration', () => {
  it('spawns a subagent that completes without clarification and returns clean final output', async () => {
    const cwd = path.resolve('.');
    const progress: string[] = [];

    const { sessionId, promise } = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      {
        cwd,
        agent: 'happy-path-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 30000,
      },
      (msg) => progress.push(msg),
    );

    const result = await promise;

    expect(result).toMatchObject({
      sessionId,
      agent: 'happy-path-tester',
      task: 'Complete the happy-path test and return the expected marker.',
      success: true,
      pendingQuestions: [],
    });
    expect(result.error).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.output).toContain('HAPPY_PATH_OK');
    expect(progress.some((line) => line.includes('❓ question:'))).toBe(false);
    expect(session.readSession(sessionId)).toBeNull();
  }, 40000);
});
