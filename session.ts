// Session file read/write utilities

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SessionState, PendingQuestion } from './types';

const SESSION_DIR = join(process.env.HOME || '', '.pi', 'pi-agent', 'sessions');

// Ensure session directory exists
function ensureSessionDir(): void {
  try {
    const { mkdirSync } = require('fs');
    mkdirSync(SESSION_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

export function getSessionFilePath(sessionId: string): string {
  ensureSessionDir();
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

// ============================================
// POLLING MECHANISM
// ============================================

export type PollCallback = (state: SessionState, changed: boolean) => void;

interface PollingConfig {
  intervalMs: number;
  onChange: PollCallback;
  onAnswer?: (questionId: string, answer: string) => void;
}

const activePollers = new Map<string, {
  intervalId: ReturnType<typeof setInterval>;
  lastActivity: number;
  lastContent: string;
}>();

export function startPolling(sessionId: string, config: PollingConfig): void {
  // Clean up any existing poller for this session
  stopPolling(sessionId);

  // Get initial state
  const initialState = readSession(sessionId);
  const lastActivity = initialState?.lastActivity ?? 0;
  const lastContent = initialState ? JSON.stringify(initialState.pendingQuestions) : '';

  // Create poller
  const intervalId = setInterval(() => {
    const state = readSession(sessionId);
    if (!state) {
      stopPolling(sessionId);
      return;
    }

    const currentContent = JSON.stringify(state.pendingQuestions);
    const changed = currentContent !== lastContent || state.lastActivity > lastActivity;

    // Check for new answers
    if (config.onAnswer && state.pendingQuestions) {
      const questions = state.pendingQuestions;
      for (const q of questions) {
        if (q.answer && q.answeredAt && q.answeredAt > lastActivity) {
          config.onAnswer(q.id, q.answer);
        }
      }
    }

    // Trigger callback
    config.onChange(state, changed);

    // Update tracking
    activePollers.set(sessionId, {
      intervalId,
      lastActivity: state.lastActivity,
      lastContent: currentContent,
    });
  }, config.intervalMs);

  // Store poller info
  activePollers.set(sessionId, {
    intervalId,
    lastActivity,
    lastContent,
  });
}

export function stopPolling(sessionId: string): void {
  const poller = activePollers.get(sessionId);
  if (poller) {
    clearInterval(poller.intervalId);
    activePollers.delete(sessionId);
  }
}

export function stopAllPolling(): void {
  for (const sessionId of activePollers.keys()) {
    stopPolling(sessionId);
  }
}

export function isPolling(sessionId: string): boolean {
  return activePollers.has(sessionId);
}