import { describe, it, expect } from 'vitest';
import { buildTeamQuestionPrompt } from '../src/features/teams/index.ts';

describe('buildTeamQuestionPrompt', () => {
  it('includes routing metadata and manager instructions for team questions', () => {
    const prompt = buildTeamQuestionPrompt({
      sessionId: 'agent-123',
      subagentId: 'clarification-tester',
      spawnType: 'team',
      teamName: 'engineering',
      agentProfile: 'clarification-tester',
      question: {
        id: 'q-456',
        question: 'Should I optimize for speed or maintainability?',
        context: 'Either is possible, but the tradeoff affects the implementation plan.',
      },
    });

    expect(prompt).toContain('[TEAM SUBAGENT QUESTION] clarification-tester is blocked and needs clarification.');
    expect(prompt).toContain('Team: engineering');
    expect(prompt).toContain('Session ID: agent-123');
    expect(prompt).toContain('Question ID: q-456');
    expect(prompt).toContain('Question: Should I optimize for speed or maintainability?');
    expect(prompt).toContain('Context: Either is possible, but the tradeoff affects the implementation plan.');
    expect(prompt).toContain('Answer directly yourself');
    expect(prompt).toContain('Escalate to the user only if this changes requirements');
    expect(prompt).toContain('answer_manager_question');
    expect(prompt).toContain('ask_user_question');
  });
});
