import { beforeEach, describe, expect, it } from 'vitest';
import registerExtension from '../src/index.ts';
import * as session from '../src/features/session/index.ts';
import { resetTeamsStateForTests } from '../src/features/teams/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';

describe('team escalation flow', () => {
  beforeEach(() => {
    resetTeamsStateForTests();
    delete process.env.PI_AGENT_SESSION_ID;
  });

  it('lets a manager collect an escalated user answer with ask_user_question and forward it back to the same team subagent', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx({ cwd: '/tmp' });
    ctx.ui.custom = async () => ({
      questions: [
        {
          question: 'Should I optimize for readability or performance?',
          header: 'Priority',
          options: [
            { label: 'Readability' },
            { label: 'Performance' },
          ],
          multiSelect: false,
        },
      ],
      answers: {
        'Should I optimize for readability or performance?': 'Readability',
      },
      cancelled: false,
    });

    registerExtension(mock.pi as any);

    const child = session.createSession('clarification-tester', 'clarification-tester', 'parent-team-session', {
      spawnType: 'team',
      teamName: 'engineering',
    });

    const pending = session.addQuestion(child.sessionId, {
      type: 'manager',
      question: 'Should I optimize for readability or performance?',
      context: 'This changes the implementation approach.',
    });

    const waitPromise = session.waitForAnswer(child.sessionId, pending.id, undefined, 2000);

    const askUserTool = mock.getTool('ask_user_question');
    const askUserResult = await askUserTool.execute(
      'tool-call-user-1',
      {
        questions: [
          {
            question: pending.question,
            header: 'Priority',
            options: [
              { label: 'Readability', description: 'Prefer simpler code and maintainability.' },
              { label: 'Performance', description: 'Prefer speed even if code is more complex.' },
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
    expect(askUserResult.details.answers[pending.question]).toBe('Readability');

    const pendingTool = mock.getTool('get_pending_questions');
    const pendingToolResult = await pendingTool.execute(
      'tool-call-pending-1',
      {},
      undefined,
      undefined,
      ctx,
    );

    expect(pendingToolResult.content[0]?.text).toContain('spawn=team');
    expect(pendingToolResult.content[0]?.text).toContain('team=engineering');
    expect(pendingToolResult.content[0]?.text).toContain('Question ID');
    expect(pendingToolResult.content[0]?.text).toContain('Should I optimize for readability or performance?');

    const answerManagerTool = mock.getTool('answer_manager_question');
    const answerResult = await answerManagerTool.execute(
      'tool-call-manager-1',
      {
        sessionId: child.sessionId,
        questionId: pending.id,
        answer: askUserResult.details.answers[pending.question],
      },
      undefined,
      undefined,
      ctx,
    );

    await expect(waitPromise).resolves.toBe('Readability');
    expect(answerResult.details).toMatchObject({
      sessionId: child.sessionId,
      questionId: pending.id,
      answer: 'Readability',
    });

    const stored = session.readSession(child.sessionId);
    expect(stored?.status).toBe('running');
    expect(stored?.pendingQuestions.find((q) => q.id === pending.id)).toMatchObject({
      answer: 'Readability',
      answeredAt: expect.any(Number),
    });
  });
});
