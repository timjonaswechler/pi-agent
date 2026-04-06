// ============================================
// USER ↔ SUBAGENT BRIDGE
// ============================================

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import * as session from '../session';
import type { PendingQuestion } from '../types';

let extensionApi: ExtensionAPI | null = null;

export function setApi(api: ExtensionAPI): void {
  extensionApi = api;
}

export function handleUserQuestion(
  sessionId: string,
  question: PendingQuestion,
): void {
  if (!extensionApi) return;

  // Use the existing ask_user_question extension or show a custom widget
  // For now, we'll emit an event that can be handled by the main extension
  
  extensionApi.sendMessage({
    customType: 'user-question',
    content: question.question,
    display: true,
    details: {
      sessionId,
      questionId: question.id,
      context: question.context,
    },
  }, {
    triggerTurn: true,
  });
}

export function onUserAnswerReceived(
  sessionId: string,
  questionId: string,
  answer: string,
): void {
  session.answerQuestion(sessionId, questionId, answer);
}

// Check for pending user questions in all sessions
export function getPendingUserQuestions(): Array<{
  sessionId: string;
  subagentId: string;
  question: PendingQuestion;
}> {
  const results: Array<{
    sessionId: string;
    subagentId: string;
    question: PendingQuestion;
  }> = [];

  const { readdirSync } = require('fs');
  const sessionDir = session.getSessionDir();

  try {
    const files = readdirSync(sessionDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.replace('.json', '');
      const state = session.readSession(sid);
      if (!state || state.status === 'killed') continue;

      const userQuestions = state.pendingQuestions.filter(
        q => q.type === 'user' && !q.answer
      );

      for (const question of userQuestions) {
        results.push({ sessionId: sid, subagentId: state.subagentId, question });
      }
    }
  } catch {}

  return results;
}