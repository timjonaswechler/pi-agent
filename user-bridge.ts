// User ↔ Subagent Bridge (Scenario 1)

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import * as session from './session';
import type { PendingQuestion } from './types';

let currentWidget: unknown = null;

export function handleUserQuestion(
  subagentSessionId: string,
  question: PendingQuestion,
  api: ExtensionAPI
): void {
  // Show widget with question
  showQuestionWidget(question, async (answer: string) => {
    // Write answer to session file
    session.answerQuestion(subagentSessionId, question.id, answer);
    // Resume subagent
    resumeSubagent(subagentSessionId);
  }, api);
}

function showQuestionWidget(
  question: PendingQuestion,
  onAnswer: (answer: string) => void,
  api: ExtensionAPI
): void {
  // TODO: Implement actual TUI widget
  // For now, show as notification/prompt
  api.showNotification({
    title: `Subagent Question (${question.type})`,
    body: question.question,
  });

  // TODO: Add input widget
  // For now, the extension will poll and pick up answers
}

function resumeSubagent(sessionId: string): void {
  // TODO: Send signal to subagent to continue
  // This would write to the session file and potentially send a signal
}

export function registerUserBridge(api: ExtensionAPI): void {
  // Register handler for user question events
  api.onEvent('subagent:user_question', (data) => {
    const { sessionId, question } = data as { sessionId: string; question: PendingQuestion };
    handleUserQuestion(sessionId, question, api);
  });
}