import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as session from '../src/features/session/index.ts';
import { processPendingQuestions, resetQuestionRoutingStateForTests } from '../src/features/teams/index.ts';
import { registerAllTools } from '../src/core/tools/index.ts';
import { createMockCtx, createMockPi } from './helpers/mock-pi-runtime.ts';

describe('M2 implemented orchestration behavior', () => {
  beforeEach(() => {
    resetQuestionRoutingStateForTests();
    delete process.env.PI_AGENT_SESSION_ID;
  });

  it('routes solo questions to the user, stores the answer, and resets the session to running', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx();
    ctx.ui.input = vi.fn(async (prompt: string, placeholder?: string) => {
      ctx.inputs.push({ prompt, placeholder });
      return 'Tim, 30';
    });

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'solo',
      teamName: undefined,
    });

    const pending = session.addQuestion(state.sessionId, {
      type: 'manager',
      question: 'What is your name and how old are you?',
      context: 'I need this to finish the test task.',
    });

    await processPendingQuestions(mock.pi as any, ctx as any);

    expect(ctx.inputs).toHaveLength(1);
    expect(ctx.inputs[0]?.prompt).toContain('Subagent clarification-tester needs clarification.');
    expect(ctx.inputs[0]?.prompt).toContain('What is your name and how old are you?');
    expect(ctx.inputs[0]?.prompt).toContain('Context: I need this to finish the test task.');
    expect(mock.sentMessages).toHaveLength(0);

    const stored = session.readSession(state.sessionId);
    const answered = stored?.pendingQuestions.find((q) => q.id === pending.id);
    expect(answered?.answer).toBe('Tim, 30');
    expect(answered?.answeredAt).toBeTypeOf('number');
    expect(stored?.status).toBe('running');
    expect(ctx.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Answered question for clarification-tester',
          level: 'success',
        }),
      ]),
    );
  });

  it('uses the implemented fallback when solo user input is empty', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx();
    ctx.ui.input = vi.fn(async (prompt: string, placeholder?: string) => {
      ctx.inputs.push({ prompt, placeholder });
      return '   ';
    });

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'solo',
      teamName: undefined,
    });

    const pending = session.addQuestion(state.sessionId, {
      type: 'manager',
      question: 'Please provide the missing detail.',
    });

    await processPendingQuestions(mock.pi as any, ctx as any);

    const stored = session.readSession(state.sessionId);
    const answered = stored?.pendingQuestions.find((q) => q.id === pending.id);
    expect(answered?.answer).toBe('User cancelled or provided no answer. Proceed with best judgment.');
    expect(stored?.status).toBe('running');
  });

  it('surfaces team questions to the active manager and does not prompt the user directly', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx();

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'team',
      teamName: 'engineering',
    });

    const pending = session.addQuestion(state.sessionId, {
      type: 'manager',
      question: 'Should I optimize for readability or performance?',
      context: 'The answer changes the implementation approach.',
    });

    await processPendingQuestions(mock.pi as any, ctx as any);

    expect(ctx.inputs).toHaveLength(0);
    expect(mock.sentMessages).toHaveLength(1);
    expect(mock.sentMessages[0]).toMatchObject({
      message: {
        customType: 'team-subagent-question',
        display: true,
        details: {
          sessionId: state.sessionId,
          questionId: pending.id,
          subagentId: 'clarification-tester',
          agentProfile: 'clarification-tester',
          spawnType: 'team',
          teamName: 'engineering',
          context: 'The answer changes the implementation approach.',
        },
      },
      options: {
        deliverAs: 'steer',
        triggerTurn: true,
      },
    });
    expect(mock.sentMessages[0]?.message.content).toContain('[TEAM SUBAGENT QUESTION]');
    expect(mock.sentMessages[0]?.message.content).toContain(`Session ID: ${state.sessionId}`);
    expect(mock.sentMessages[0]?.message.content).toContain(`Question ID: ${pending.id}`);
    expect(mock.sentMessages[0]?.message.content).toContain('answer_manager_question');
    expect(mock.sentMessages[0]?.message.content).toContain('ask_user_question');
  });

  it('announces each team question only once while it remains pending', async () => {
    const mock = createMockPi();
    const ctx = createMockCtx();

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'team',
      teamName: 'engineering',
    });

    const pending = session.addQuestion(state.sessionId, {
      type: 'manager',
      question: 'One routing decision please.',
    });

    await processPendingQuestions(mock.pi as any, ctx as any);
    await processPendingQuestions(mock.pi as any, ctx as any);

    expect(mock.sentMessages).toHaveLength(1);

    session.answerQuestion(state.sessionId, pending.id, 'Manager decides directly.');
    await processPendingQuestions(mock.pi as any, ctx as any);
    expect(mock.sentMessages).toHaveLength(1);
  });

  it('answer_manager_question writes the answer and unblocks waitForAnswer for the direct team-manager path', async () => {
    const mock = createMockPi();
    registerAllTools(mock.pi as any);

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'team',
      teamName: 'engineering',
    });

    const pending = session.addQuestion(state.sessionId, {
      type: 'manager',
      question: 'Should I answer directly?',
    });

    const waitPromise = session.waitForAnswer(state.sessionId, pending.id);

    const answerTool = mock.getTool('answer_manager_question');
    const result = await answerTool.execute(
      'tool-call-1',
      {
        sessionId: state.sessionId,
        questionId: pending.id,
        answer: 'Yes. Answer directly as manager.',
      },
      undefined,
      undefined,
      { cwd: '/tmp' },
    );

    await expect(waitPromise).resolves.toBe('Yes. Answer directly as manager.');
    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({
      sessionId: state.sessionId,
      questionId: pending.id,
      answer: 'Yes. Answer directly as manager.',
    });

    const stored = session.readSession(state.sessionId);
    const answered = stored?.pendingQuestions.find((q) => q.id === pending.id);
    expect(answered?.answer).toBe('Yes. Answer directly as manager.');
    expect(stored?.status).toBe('running');
  });

  it('ask_manager_question returns the exact persisted answer once a manager responds', async () => {
    const mock = createMockPi();
    registerAllTools(mock.pi as any);

    const state = session.createSession('clarification-tester', 'clarification-tester', undefined, {
      spawnType: 'solo',
      teamName: undefined,
    });

    process.env.PI_AGENT_SESSION_ID = state.sessionId;
    const askTool = mock.getTool('ask_manager_question');

    const askPromise = askTool.execute(
      'tool-call-2',
      {
        question: 'What is your name and how old are you?',
        context: 'Needed for the final answer.',
      },
      undefined,
      undefined,
      { cwd: '/tmp' },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const pending = session.getUnansweredManagerQuestions(state.sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      question: 'What is your name and how old are you?',
      context: 'Needed for the final answer.',
      spawnType: 'solo',
      agentProfile: 'clarification-tester',
    });

    session.answerQuestion(state.sessionId, pending[0]!.id, 'Tim, 30');

    const result = await askPromise;
    expect(result.details).toMatchObject({
      questionId: pending[0]!.id,
      question: 'What is your name and how old are you?',
      answer: 'Tim, 30',
    });
    expect(result.content[0]?.text).toContain('Manager answered: Tim, 30');
  });
});
