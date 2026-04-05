// Manager ↔ Subagent Bridge (Scenario 2)

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as session from './session';
import type { PendingQuestion } from './types';

// Track which sessions are in "manager mode"
const managerModeSessions = new Set<string>();

export function setManagerMode(sessionId: string, enabled: boolean): void {
  if (enabled) {
    managerModeSessions.add(sessionId);
  } else {
    managerModeSessions.delete(sessionId);
  }
}

export function isManagerMode(sessionId: string): boolean {
  return managerModeSessions.has(sessionId);
}

export function getManagerModeSessions(): string[] {
  return Array.from(managerModeSessions);
}

// Get all pending manager questions across all tracked sessions
export function getAllPendingManagerQuestions(): Array<{
  sessionId: string;
  subagentId: string;
  question: PendingQuestion;
}> {
  const results: Array<{
    sessionId: string;
    subagentId: string;
    question: PendingQuestion;
  }> = [];

  for (const sessionId of managerModeSessions) {
    const state = session.readSession(sessionId);
    if (!state) continue;

    // Only get 'manager' type questions that are unanswered
    const managerQuestions = state.pendingQuestions.filter(
      q => q.type === 'manager' && !q.answer
    );

    for (const question of managerQuestions) {
      results.push({
        sessionId,
        subagentId: state.subagentId,
        question,
      });
    }
  }

  return results;
}

export function handleManagerQuestion(
  subagentSessionId: string,
  question: PendingQuestion,
  api: ExtensionAPI
): void {
  // Mark this session as in manager mode
  setManagerMode(subagentSessionId, true);

  // The manager (main agent) handles this via the tools
  // We just store the question - tools expose it to the manager
  console.log(`[pi-agent] Manager question from ${subagentSessionId}: ${question.question}`);
}

export async function managerAnswer(
  subagentSessionId: string,
  questionId: string,
  answer: string,
  api: ExtensionAPI
): Promise<void> {
  // Write answer to session file
  session.answerQuestion(subagentSessionId, questionId, answer);
  
  console.log(`[pi-agent] Manager answered question ${questionId} for session ${subagentSessionId}`);

  // Notify subagent to continue via session file
  notifySubagentContinue(subagentSessionId);
}

export async function forwardQuestionToUser(
  subagentSessionId: string,
  questionId: string,
  api: ExtensionAPI
): Promise<void> {
  // Get the question
  const state = session.readSession(subagentSessionId);
  if (!state) return;

  const question = state.pendingQuestions.find(q => q.id === questionId);
  if (!question) return;

  // Change type from 'manager' to 'user'
  question.type = 'user';
  state.lastActivity = Date.now();
  state.status = 'waiting_user';
  session.writeSession(state);

  console.log(`[pi-agent] Forwarded question ${questionId} to user for session ${subagentSessionId}`);

  // The user-bridge will pick this up and show the question widget
}

function notifySubagentContinue(sessionId: string): void {
  // Write a special "continue" marker to the session file
  // The subagent will poll and see this marker
  const state = session.readSession(sessionId);
  if (state) {
    state.status = 'running';
    state.lastActivity = Date.now();
    session.writeSession(state);
  }
}

// ============================================
// TOOL REGISTRATION
// ============================================

export function registerManagerBridge(api: ExtensionAPI): void {
  // Tool: Get all pending manager questions
  api.registerTool({
    name: 'get_pending_manager_questions',
    description: 'Get all pending questions from subagents waiting for manager response. The manager decides whether to answer directly or forward to user.',
    params: Type.Object({}),
    handler: async () => {
      const pending = getAllPendingManagerQuestions();

      if (pending.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No pending manager questions.',
            },
          ],
        };
      }

      // Format for the manager
      const formatted = pending.map(p => {
        return `Session: ${p.sessionId} | Agent: ${p.subagentId}
Question (${p.question.id}): ${p.question.question}
Asked at: ${new Date(p.question.timestamp).toISOString()}`;
      }).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Pending manager questions (${pending.length}):\n\n${formatted}\n\nUse answer_manager_question or forward_to_user.`,
          },
        ],
      };
    },
  });

  // Tool: Answer a question directly
  api.registerTool({
    name: 'answer_manager_question',
    description: 'Answer a pending question from a subagent directly. Use this when you can answer the question yourself.',
    params: Type.Object({
      subagentSessionId: Type.String({ description: 'Session ID of the subagent' }),
      questionId: Type.String({ description: 'ID of the question to answer' }),
      answer: Type.String({ description: 'Your answer to the subagent' }),
    }),
    handler: async (params) => {
      await managerAnswer(params.subagentSessionId, params.questionId, params.answer, api);
      return {
        content: [
          {
            type: 'text',
            text: `Answered question ${params.questionId} for subagent ${params.subagentSessionId}.`,
          },
        ],
      };
    },
  });

  // Tool: Forward question to user
  api.registerTool({
    name: 'forward_to_user',
    description: 'Forward a subagent question to the user. The user will answer via ask_user_question widget.',
    params: Type.Object({
      subagentSessionId: Type.String({ description: 'Session ID of the subagent' }),
      questionId: Type.String({ description: 'ID of the question to forward' }),
    }),
    handler: async (params) => {
      await forwardQuestionToUser(params.subagentSessionId, params.questionId, api);
      return {
        content: [
          {
            type: 'text',
            text: `Forwarded question ${params.questionId} to user. Waiting for response...`,
          },
        ],
      };
    },
  });
}

// Cleanup on shutdown
export function cleanupManagerBridge(): void {
  managerModeSessions.clear();
}