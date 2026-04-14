import path from 'path';
import { expect, it } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { spawnAndAwait } from '../src/features/sub-agent/index.ts';
import registerExtension from '../src/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';
import { describeIntegration, waitFor } from './helpers/integration.ts';

describeIntegration('subprocess team escalation integration', () => {
  it('spawns a team subagent, collects an escalated user answer, forwards it, and sees the child complete', async () => {
    const cwd = path.resolve('.');
    const progress: string[] = [];

    const { sessionId, promise } = spawnAndAwait(
      'Verify the team escalation clarification loop and use the answer in the final response.',
      {
        cwd,
        agent: 'clarification-tester',
        mode: 'manager',
        spawnType: 'team',
        teamName: 'engineering',
        timeoutMs: 45000,
      },
      (msg) => progress.push(msg),
    );

    const pending = await waitFor(() => {
      const state = session.readSession(sessionId);
      const unanswered = state?.pendingQuestions.filter((q) => q.type === 'manager' && !q.answer) ?? [];
      return unanswered.length > 0 ? { state, unanswered } : null;
    }, 15000);

    expect(pending.unanswered).toHaveLength(1);
    expect(pending.state).toMatchObject({
      sessionId,
      spawnType: 'team',
      teamName: 'engineering',
      agentProfile: 'clarification-tester',
      status: 'waiting_manager',
    });
    expect(pending.unanswered[0]).toMatchObject({
      question: 'What is your name and how old are you?',
      spawnType: 'team',
      teamName: 'engineering',
      agentProfile: 'clarification-tester',
    });

    const mock = createMockPi();
    const ctx = createMockCtx({ cwd });
    ctx.ui.custom = async () => ({
      questions: [
        {
          question: pending.unanswered[0]!.question,
          header: 'Answer',
          options: [
            { label: 'Tim, 30' },
            { label: 'Alex, 28' },
          ],
          multiSelect: false,
        },
      ],
      answers: {
        [pending.unanswered[0]!.question]: 'Tim, 30',
      },
      cancelled: false,
    });

    registerExtension(mock.pi as any);

    const askUserTool = mock.getTool('ask_user_question');
    const askUserResult = await askUserTool.execute(
      'tool-call-user-team-1',
      {
        questions: [
          {
            question: pending.unanswered[0]!.question,
            header: 'Answer',
            options: [
              { label: 'Tim, 30', description: 'Use the provided test answer.' },
              { label: 'Alex, 28', description: 'Alternative answer.' },
            ],
            multiSelect: false,
          },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(askUserResult.details.cancelled).toBe(false);
    expect(askUserResult.details.answers[pending.unanswered[0]!.question]).toBe('Tim, 30');

    const answerManagerTool = mock.getTool('answer_manager_question');
    const answerResult = await answerManagerTool.execute(
      'tool-call-manager-team-1',
      {
        sessionId,
        questionId: pending.unanswered[0]!.id,
        answer: askUserResult.details.answers[pending.unanswered[0]!.question],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(answerResult.details).toMatchObject({
      sessionId,
      questionId: pending.unanswered[0]!.id,
      answer: 'Tim, 30',
    });

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
  }, 60000);
});
