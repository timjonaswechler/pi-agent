import { describe, it, expect } from 'vitest';
import {
  createSession,
  readSession,
  writeSession,
  addQuestion,
  getPendingQuestions,
  getAllPendingManagerQuestions,
  answerQuestion,
  waitForAnswer,
  deleteSession,
} from '../src/features/session/index.ts';

describe('session storage and question flow', () => {
  it('writes and reads session updates', () => {
    const session = createSession('reviewer', 'reviewer', 'parent-1', {
      spawnType: 'solo',
      teamName: undefined,
    });

    const stored = readSession(session.sessionId);
    expect(stored).toMatchObject({
      sessionId: session.sessionId,
      subagentId: 'reviewer',
      agentProfile: 'reviewer',
      parentSessionId: 'parent-1',
      spawnType: 'solo',
      status: 'idle',
    });

    stored!.status = 'running';
    writeSession(stored!);

    const updated = readSession(session.sessionId);
    expect(updated?.status).toBe('running');
  });

  it('stores session spawn metadata when creating a session', () => {
    const session = createSession('researcher', 'researcher', undefined, {
      spawnType: 'solo',
      teamName: undefined,
    });

    const stored = readSession(session.sessionId);
    expect(stored).toMatchObject({
      sessionId: session.sessionId,
      subagentId: 'researcher',
      agentProfile: 'researcher',
      spawnType: 'solo',
    });
  });

  it('tracks pending questions and clears them once answered', () => {
    const session = createSession('reviewer', 'reviewer');

    const pending = addQuestion(session.sessionId, {
      type: 'manager',
      question: 'Which path should I take?',
      context: 'Need direction before editing.',
    });

    expect(getPendingQuestions(session.sessionId)).toEqual([
      expect.objectContaining({
        id: pending.id,
        question: 'Which path should I take?',
        context: 'Need direction before editing.',
      }),
    ]);

    answerQuestion(session.sessionId, pending.id, 'Take the minimal-change path.');

    const stored = readSession(session.sessionId);
    const answered = stored?.pendingQuestions.find((q) => q.id === pending.id);
    expect(answered).toMatchObject({
      answer: 'Take the minimal-change path.',
    });
    expect(stored?.status).toBe('running');
    expect(getPendingQuestions(session.sessionId)).toEqual([]);
  });

  it('copies session metadata into pending questions and aggregated manager-question lookup', () => {
    const session = createSession('team-reviewer', 'team-reviewer', undefined, {
      spawnType: 'team',
      teamName: 'engineering',
    });

    const pending = addQuestion(session.sessionId, {
      type: 'manager',
      question: 'Should I optimize for readability or performance?',
      context: 'Both are possible tradeoffs.',
    });

    expect(pending).toMatchObject({
      type: 'manager',
      question: 'Should I optimize for readability or performance?',
      spawnType: 'team',
      teamName: 'engineering',
      agentProfile: 'team-reviewer',
    });

    expect(getAllPendingManagerQuestions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: session.sessionId,
          subagentId: 'team-reviewer',
          spawnType: 'team',
          teamName: 'engineering',
          agentProfile: 'team-reviewer',
          question: expect.objectContaining({
            id: pending.id,
            spawnType: 'team',
            teamName: 'engineering',
            agentProfile: 'team-reviewer',
          }),
        }),
      ]),
    );
  });

  it('waitForAnswer resolves when an answer is written later', async () => {
    const session = createSession('reviewer', 'reviewer');
    const pending = addQuestion(session.sessionId, {
      type: 'manager',
      question: 'Need a blocking clarification.',
    });

    const waitPromise = waitForAnswer(session.sessionId, pending.id, undefined, 2000);

    setTimeout(() => {
      answerQuestion(session.sessionId, pending.id, 'Here is the answer.');
    }, 50);

    await expect(waitPromise).resolves.toBe('Here is the answer.');
  });

  it('waitForAnswer returns null on timeout', async () => {
    const session = createSession('reviewer', 'reviewer');
    const pending = addQuestion(session.sessionId, {
      type: 'manager',
      question: 'This will time out.',
    });

    await expect(waitForAnswer(session.sessionId, pending.id, undefined, 50)).resolves.toBeNull();
  });

  it('deleteSession removes the stored session file', () => {
    const session = createSession('reviewer', 'reviewer');
    expect(readSession(session.sessionId)).not.toBeNull();

    deleteSession(session.sessionId);
    expect(readSession(session.sessionId)).toBeNull();
  });
});
