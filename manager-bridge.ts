// Manager ↔ Subagent Bridge (Scenario 2)

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import * as session from './session';
import type { PendingQuestion } from './types';

export function handleManagerQuestion(
  subagentSessionId: string,
  question: PendingQuestion,
  api: ExtensionAPI
): void {
  // Manager reads question from session file
  // Manager decides: answer itself OR route to user
  const state = session.readSession(subagentSessionId);
  if (!state) return;

  // The manager (main agent) handles this via the tool result
  // This function stores the question and notifies the manager
  const pending = session.getPendingQuestions(subagentSessionId);
  if (pending.length > 0) {
    // Show something to the manager
    // The manager will use get_pending_manager_questions tool
  }
}

export async function managerAnswer(
  subagentSessionId: string,
  questionId: string,
  answer: string,
  api: ExtensionAPI
): Promise<void> {
  // Write answer to session file
  session.answerQuestion(subagentSessionId, questionId, answer);

  // Notify subagent to continue
  notifySubagentContinue(subagentSessionId);
}

function notifySubagentContinue(sessionId: string): void {
  // TODO: Write continuation signal to session file
  // Subagent will poll and pick up the answer
}

export function registerManagerBridge(api: ExtensionAPI): void {
  // Register tool for manager to answer questions
  api.registerTool({
    name: 'get_pending_manager_questions',
    description: 'Get pending questions from subagents waiting for manager response',
    params: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      // This would need to track active subagent sessions
      return {
        content: [
          {
            type: 'text',
            text: 'No pending questions',
          },
        ],
      };
    },
  });

  api.registerTool({
    name: 'answer_manager_question',
    description: 'Answer a pending question from a subagent',
    params: {
      type: 'object',
      properties: {
        subagentSessionId: { type: 'string' },
        questionId: { type: 'string' },
        answer: { type: 'string' },
      },
    },
    handler: async (params) => {
      await managerAnswer(params.subagentSessionId, params.questionId, params.answer, api);
      return {
        content: [
          {
            type: 'text',
            text: `Answered question ${params.questionId}`,
          },
        ],
      };
    },
  });
}