// ask_manager_question implementation

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as session from './session';
import type { PendingQuestion } from './types';

type ManagerQuestionHandler = (
  sessionId: string,
  question: PendingQuestion
) => void;

let handler: ManagerQuestionHandler | null = null;

export function register(api: ExtensionAPI, onQuestion: ManagerQuestionHandler): void {
  handler = onQuestion;

  // Register ask_manager_question tool
  api.registerTool({
    name: 'ask_manager_question',
    description: 'Ask the manager (parent agent) for help or clarification',
    params: Type.Object({
      session_id: Type.String({ description: 'Session ID of the subagent' }),
      question: Type.String({ description: 'Question to ask the manager' }),
    }),
    handler: async (params) => {
      const question: PendingQuestion = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'manager',
        question: params.question,
        timestamp: Date.now(),
      };

      // Add to session file
      session.addQuestion(params.session_id, question);

      // Notify handler if registered
      if (handler) {
        handler(params.session_id, question);
      }

      // Return placeholder - actual response will come via session file
      return {
        content: [
          {
            type: 'text',
            text: `Question sent to manager: ${params.question}`,
          },
        ],
        // Block until answer is available in session file
        // This would require custom handling in the extension
      };
    },
  });
}

// Export for use in manager-bridge
export function triggerManagerQuestion(sessionId: string, question: PendingQuestion): void {
  if (handler) {
    handler(sessionId, question);
  }
}