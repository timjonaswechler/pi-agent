// Session file read/write utilities

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SessionState, PendingQuestion } from './types';

const SESSION_DIR = join(process.env.HOME || '', '.pi', 'interactive-team', 'sessions');

// Ensure session directory exists
function ensureSessionDir(): void {
  // Lazy init - this will be called on first use
}

export function getSessionFilePath(sessionId: string): string {
  return join(SESSION_DIR, `${sessionId}.json`);
}

export function readSession(sessionId: string): SessionState | null {
  const filePath = getSessionFilePath(sessionId);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeSession(state: SessionState): void {
  const filePath = getSessionFilePath(state.sessionId);
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function createSession(subagentId: string): SessionState {
  const sessionId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const state: SessionState = {
    sessionId,
    subagentId,
    status: 'idle',
    pendingQuestions: [],
    lastActivity: Date.now(),
  };
  writeSession(state);
  return state;
}

export function addQuestion(sessionId: string, question: PendingQuestion): void {
  const state = readSession(sessionId);
  if (state) {
    state.pendingQuestions.push(question);
    state.lastActivity = Date.now();
    if (question.type === 'manager') {
      state.status = 'waiting_manager';
    } else {
      state.status = 'waiting_user';
    }
    writeSession(state);
  }
}

export function getPendingQuestions(sessionId: string): PendingQuestion[] {
  const state = readSession(sessionId);
  return state?.pendingQuestions.filter(q => !q.answer) ?? [];
}

export function answerQuestion(sessionId: string, questionId: string, answer: string): void {
  const state = readSession(sessionId);
  if (state) {
    const question = state.pendingQuestions.find(q => q.id === questionId);
    if (question) {
      question.answer = answer;
      question.answeredAt = Date.now();
      state.lastActivity = Date.now();
      // Reset status if no more pending questions
      const stillPending = state.pendingQuestions.some(q => !q.answer);
      if (!stillPending) {
        state.status = 'running';
      }
      writeSession(state);
    }
  }
}