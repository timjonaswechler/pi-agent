import { describe, it, expect } from 'vitest';
import {
  createSession,
  readSession,
  addQuestion,
  getAllPendingManagerQuestions,
} from '../src/features/session/index.ts';

describe('session metadata propagation', () => {
  it('stores spawn metadata on the session', () => {
    const session = createSession('researcher', 'researcher', undefined, {
      spawnType: 'solo',
      teamName: undefined,
    });

    const stored = readSession(session.sessionId);
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      sessionId: session.sessionId,
      subagentId: 'researcher',
      agentProfile: 'researcher',
      spawnType: 'solo',
    });
  });

  it('copies session metadata into pending questions and aggregated question lookup', () => {
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

    const allPending = getAllPendingManagerQuestions();
    expect(allPending).toEqual(
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
});
