import path from 'path';
import { expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { spawnAndAwait } from '../src/features/sub-agent/index.ts';
import { describeIntegration, waitFor } from './helpers/integration.ts';

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
    expect(result.output).toContain('Tim');
    expect(result.output).toContain('30');
    expect(result.pendingQuestions).toEqual([]);

    const finalState = session.readSession(sessionId);
    expect(finalState).toBeNull();

    const questionEvents = progress.filter((line) => line.includes('❓ question:'));
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toContain('What is your name and how old are you?');
  }, 40000);
});
