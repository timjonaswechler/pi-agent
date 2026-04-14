import path from 'path';
import { expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { spawnAndAwait } from '../src/features/sub-agent/index.ts';
import { describeIntegration } from './helpers/integration.ts';

describeIntegration('subprocess parallel integration', () => {
  it('runs multiple happy-path subagents in parallel and keeps their results isolated', async () => {
    const cwd = path.resolve('.');

    const a = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      { cwd, agent: 'happy-path-tester', mode: 'manager', spawnType: 'solo', timeoutMs: 30000 },
    );
    const b = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      { cwd, agent: 'happy-path-tester', mode: 'manager', spawnType: 'solo', timeoutMs: 30000 },
    );

    expect(a.sessionId).not.toBe(b.sessionId);

    const [resultA, resultB] = await Promise.all([a.promise, b.promise]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.output).toContain('HAPPY_PATH_OK');
    expect(resultB.output).toContain('HAPPY_PATH_OK');
    expect(resultA.pendingQuestions).toEqual([]);
    expect(resultB.pendingQuestions).toEqual([]);
    expect(session.readSession(a.sessionId)).toBeNull();
    expect(session.readSession(b.sessionId)).toBeNull();
  }, 40000);

  it('isolates a timed-out clarification subagent from successful siblings', async () => {
    const cwd = path.resolve('.');

    const successA = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      { cwd, agent: 'happy-path-tester', mode: 'manager', spawnType: 'solo', timeoutMs: 30000 },
    );
    const blocked = spawnAndAwait(
      'Verify the clarification loop and confirm the answer.',
      { cwd, agent: 'clarification-tester', mode: 'manager', spawnType: 'solo', timeoutMs: 3000 },
    );
    const successB = spawnAndAwait(
      'Complete the happy-path test and return the expected marker.',
      { cwd, agent: 'happy-path-tester', mode: 'manager', spawnType: 'solo', timeoutMs: 30000 },
    );

    const [resultA, resultBlocked, resultB] = await Promise.all([
      successA.promise,
      blocked.promise,
      successB.promise,
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.output).toContain('HAPPY_PATH_OK');
    expect(resultB.output).toContain('HAPPY_PATH_OK');

    expect(resultBlocked.success).toBe(false);
    expect(resultBlocked.error).toContain('Timed out after 3000ms');
    expect(Array.isArray(resultBlocked.pendingQuestions)).toBe(true);

    expect(session.readSession(successA.sessionId)).toBeNull();
    expect(session.readSession(blocked.sessionId)).toBeNull();
    expect(session.readSession(successB.sessionId)).toBeNull();
  }, 50000);
});
