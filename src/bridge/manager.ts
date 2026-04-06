// ============================================
// MANAGER ↔ SUBAGENT BRIDGE
// ============================================

import * as session from '../session';
import type { PendingQuestion, BridgeEvent } from '../types';

// Track sessions in manager mode
const managerModeSessions = new Set<string>();

// Event handlers
type ManagerEventHandler = (event: BridgeEvent) => void;
const eventHandlers: ManagerEventHandler[] = [];

export function onManagerEvent(handler: ManagerEventHandler): void {
  eventHandlers.push(handler);
}

function emitManagerEvent(event: BridgeEvent): void {
  eventHandlers.forEach(handler => handler(event));
}

// ============================================
// MANAGER MODE TRACKING
// ============================================

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

// ============================================
// MANAGER QUESTION HANDLING
// ============================================

export function handleManagerQuestion(
  sessionId: string,
  question: PendingQuestion,
): void {
  setManagerMode(sessionId, true);
  
  emitManagerEvent({
    type: 'question_asked',
    sessionId,
    subagentId: question.type,
    payload: question,
    timestamp: Date.now(),
  });
}

// ============================================
// MANAGER ACTIONS
// ============================================

export function managerAnswer(
  sessionId: string,
  questionId: string,
  answer: string,
): void {
  session.answerQuestion(sessionId, questionId, answer);

  emitManagerEvent({
    type: 'answer_received',
    sessionId,
    subagentId: 'manager',
    payload: { questionId, answer },
    timestamp: Date.now(),
  });
}

export function forwardQuestionToUser(
  sessionId: string,
  questionId: string,
): void {
  const state = session.readSession(sessionId);
  if (!state) return;

  const question = state.pendingQuestions.find(q => q.id === questionId);
  if (!question) return;

  // Change type from manager to user
  question.type = 'user';
  state.lastActivity = Date.now();
  state.status = 'waiting_user';
  session.writeSession(state);

  // Stop tracking as manager mode for this question
  emitManagerEvent({
    type: 'question_asked',
    sessionId,
    subagentId: 'user',
    payload: question,
    timestamp: Date.now(),
  });
}

// ============================================
// UTILITIES
// ============================================

export function getAllPendingManagerQuestions(): Array<{
  sessionId: string;
  subagentId: string;
  question: PendingQuestion;
}> {
  return session.getAllPendingManagerQuestions();
}

export function cleanupManagerBridge(): void {
  managerModeSessions.clear();
  eventHandlers.length = 0;
}