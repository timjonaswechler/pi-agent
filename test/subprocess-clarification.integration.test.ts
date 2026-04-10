import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { spawnAndAwait } from '../src/features/sub-agent/index.ts';

function hasPiCli(): boolean {
  const result = spawnSync('pi', ['--help'], { encoding: 'utf-8' });
  return !result.error;
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 10000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

const runIntegration = process.env.PI_INTEGRATION === '1' && hasPiCli();
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('subprocess clarification integration', () => {
  it('spawns clarification-tester, observes one pending manager question, answers it, and sees the child complete with that answer', async () => {
    const cwd = path.resolve('.');
    const progress: string[] = [];

    const { sessionId, promise } = spawnAndAwait(
      'Verify the clarification loop and confirm the answer.',
      {
        cwd,
        agent: 'clarification-tester',
        mode: 'manager',
        spawnType: 'solo',
        timeoutMs: 30000,
      },
      (msg) => progress.push(msg),
    );

    const pending = await waitFor(() => {
      const state = session.readSession(sessionId);
      const unanswered = state?.pendingQuestions.filter((q) => q.type === 'manager' && !q.answer) ?? [];
      return unanswered.length > 0 ? { state, unanswered } : null;
    }, 15000);

    expect(pending.unanswered).toHaveLength(1);
    expect(pending.unanswered[0]).toMatchObject({
      question: 'What is your name and how old are you?',
      spawnType: 'solo',
      agentProfile: 'clarification-tester',
    });

    session.answerQuestion(sessionId, pending.unanswered[0]!.id, 'Tim, 30');

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toContain('clarification');
    expect(result.output).toContain('Name:** Tim');
    expect(result.output).toContain('Age:** 30');
    expect(result.pendingQuestions).toEqual([]);

    const finalState = session.readSession(sessionId);
    expect(finalState?.status).toBe('complete');
    expect(finalState?.pendingQuestions).toHaveLength(1);
    expect(finalState?.pendingQuestions[0]).toMatchObject({
      question: 'What is your name and how old are you?',
      answer: 'Tim, 30',
    });

    const questionEvents = progress.filter((line) => line.includes('❓ question:'));
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toContain('What is your name and how old are you?');
  }, 40000);
});
