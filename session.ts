// Session file read/write utilities

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SessionState, PendingQuestion } from './types';

const SESSION_DIR = process.env.PI_AGENT_SESSION_DIR || 
  join(process.env.HOME || '', '.pi', 'pi-agent', 'sessions');

// ============================================
// POLLING MECHANISM (On-Demand)
// ============================================

export type PollCallback = (state: SessionState) => void;
export type AnswerCallback = (questionId: string, answer: string) => void;

interface PollingConfig {
  intervalMs: number;
  onChange: PollCallback;
  onAnswer: AnswerCallback;
}

interface PollerState {
  intervalId: ReturnType<typeof setInterval>;
  lastActivity: number;
  lastQuestionCount: number;
  config: PollingConfig;
}

const activePollers = new Map<string, PollerState>();

// Session callbacks - set by extension on load
let globalOnAnswer: AnswerCallback | null = null;
let globalOnChange: PollCallback | null = null;

export function setGlobalPollCallbacks(onChange: PollCallback, onAnswer: AnswerCallback): void {
  globalOnChange = onChange;
  globalOnAnswer = onAnswer;
}

function createPoller(sessionId: string, config: PollingConfig): void {
  // Clean up any existing poller for this session
  stopPolling(sessionId);

  // Get initial state
  const initialState = readSession(sessionId);
  const lastActivity = initialState?.lastActivity ?? 0;
  const lastQuestionCount = initialState?.pendingQuestions.length ?? 0;

  // Create poller
  const intervalId = setInterval(() => {
    const state = readSession(sessionId);
    if (!state) {
      stopPolling(sessionId);
      return;
    }

    // Check for new answers
    if (globalOnAnswer) {
      for (const q of state.pendingQuestions) {
        if (q.answer && q.answeredAt && q.answeredAt > lastActivity) {
          globalOnAnswer(q.id, q.answer);
        }
      }
    }

    // Trigger onChange callback
    if (globalOnChange) {
      globalOnChange(state);
    }

    // Update tracking
    const poller = activePollers.get(sessionId);
    if (poller) {
      poller.lastActivity = state.lastActivity;
      poller.lastQuestionCount = state.pendingQuestions.length;
    }

    // Auto-stop if no pending questions (all answered or no questions)
    const unanswered = state.pendingQuestions.filter(q => !q.answer);
    if (unanswered.length === 0 && state.status !== 'waiting_manager' && state.status !== 'waiting_user') {
      stopPolling(sessionId);
    }
  }, config.intervalMs);

  // Store poller info
  activePollers.set(sessionId, {
    intervalId,
    lastActivity,
    lastQuestionCount,
    config,
  });
}

export function startPollingForSession(sessionId: string): void {
  if (activePollers.has(sessionId)) return; // Already polling
  
  const state = readSession(sessionId);
  if (!state) return;

  // Only start if there are unanswered questions
  const unanswered = state.pendingQuestions.filter(q => !q.answer);
  if (unanswered.length === 0) return;

  createPoller(sessionId, {
    intervalMs: 500,
    onChange: (s) => {},
    onAnswer: (id, ans) => {},
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

// ============================================
// SESSION MANAGEMENT
// ============================================

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

    // AUTO-START POLLING when question is added
    startPollingForSession(sessionId);
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
        // AUTO-STOP POLLING when all questions answered
        stopPolling(sessionId);
      }
      writeSession(state);
    }
  }
}

// Get all unanswered questions for a session
export function getUnansweredQuestions(sessionId: string): PendingQuestion[] {
  const state = readSession(sessionId);
  return state?.pendingQuestions.filter(q => !q.answer) ?? [];
}

// Get session status
export function getSessionStatus(sessionId: string): SessionState['status'] | null {
  const state = readSession(sessionId);
  return state?.status ?? null;
}