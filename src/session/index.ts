// ============================================
// SESSION MANAGEMENT WITH ON-DEMAND POLLING
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SessionState, PendingQuestion, SessionStatus } from '../types';

// Configurable session directory
const SESSION_DIR = process.env.PI_AGENT_SESSION_DIR || 
  join(process.env.HOME || '', '.pi', 'pi-agent', 'sessions');

// ============================================
// SESSION CRUD
// ============================================

function ensureSessionDir(): void {
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
  } catch {
    // May already exist
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

export function createSession(subagentId: string, agentProfile?: string, parentSessionId?: string): SessionState {
  const sessionId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const state: SessionState = {
    sessionId,
    subagentId,
    agentProfile,
    status: 'idle',
    pendingQuestions: [],
    parentSessionId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  writeSession(state);
  return state;
}

export function updateSessionStatus(sessionId: string, status: SessionStatus): void {
  const state = readSession(sessionId);
  if (state) {
    state.status = status;
    state.lastActivity = Date.now();
    writeSession(state);
  }
}

export function deleteSession(sessionId: string): void {
  const filePath = getSessionFilePath(sessionId);
  if (existsSync(filePath)) {
    try {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
    } catch {
      // Ignore errors on delete
    }
  }
}

// ============================================
// QUESTION MANAGEMENT
// ============================================

export function addQuestion(sessionId: string, question: Omit<PendingQuestion, 'id' | 'timestamp'>): PendingQuestion {
  const state = readSession(sessionId);
  if (!state) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const fullQuestion: PendingQuestion = {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...question,
  };

  state.pendingQuestions.push(fullQuestion);
  state.lastActivity = Date.now();
  state.status = question.type === 'manager' ? 'waiting_manager' : 'waiting_user';
  writeSession(state);

  return fullQuestion;
}

export function getPendingQuestions(sessionId: string): PendingQuestion[] {
  const state = readSession(sessionId);
  return state?.pendingQuestions.filter(q => !q.answer) ?? [];
}

export function getUnansweredManagerQuestions(sessionId: string): PendingQuestion[] {
  const state = readSession(sessionId);
  return state?.pendingQuestions.filter(q => q.type === 'manager' && !q.answer) ?? [];
}

export function answerQuestion(sessionId: string, questionId: string, answer: string): void {
  const state = readSession(sessionId);
  if (!state) return;

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

export function getAllPendingManagerQuestions(): Array<{ sessionId: string; subagentId: string; question: PendingQuestion }> {
  const results: Array<{ sessionId: string; subagentId: string; question: PendingQuestion }> = [];
  
  // Get all session files
  ensureSessionDir();
  const { readdirSync } = require('fs');
  
  try {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sessionId = file.replace('.json', '');
      const state = readSession(sessionId);
      if (!state || state.status === 'killed') continue;

      const managerQuestions = state.pendingQuestions.filter(
        q => q.type === 'manager' && !q.answer
      );

      for (const question of managerQuestions) {
        results.push({ sessionId, subagentId: state.subagentId, question });
      }
    }
  } catch {
    // Ignore read errors
  }

  return results;
}

// ============================================
// POLLING (On-Demand)
// ============================================

export type PollCallback = (state: SessionState) => void;
export type AnswerCallback = (sessionId: string, questionId: string, answer: string) => void;

interface PollerState {
  intervalId: ReturnType<typeof setInterval>;
  lastActivity: number;
  callbacks: {
    onChange: PollCallback;
    onAnswer: AnswerCallback;
  };
}

const activePollers = new Map<string, PollerState>();

let globalOnChange: PollCallback | null = null;
let globalOnAnswer: AnswerCallback | null = null;

export function setGlobalPollCallbacks(onChange: PollCallback, onAnswer: AnswerCallback): void {
  globalOnChange = onChange;
  globalOnAnswer = onAnswer;
}

function createPoller(sessionId: string, onChange: PollCallback, onAnswer: AnswerCallback): void {
  // Stop existing poller
  stopPolling(sessionId);

  const state = readSession(sessionId);
  const lastActivity = state?.lastActivity ?? 0;

  const intervalId = setInterval(() => {
    const currentState = readSession(sessionId);
    if (!currentState) {
      stopPolling(sessionId);
      return;
    }

    // Check for new answers
    if (globalOnAnswer) {
      for (const q of currentState.pendingQuestions) {
        if (q.answer && q.answeredAt && q.answeredAt > lastActivity) {
          globalOnAnswer(sessionId, q.id, q.answer);
        }
      }
    }

    // Trigger onChange
    if (globalOnChange) {
      globalOnChange(currentState);
    }

    // Auto-stop if no pending questions
    const unanswered = currentState.pendingQuestions.filter(q => !q.answer);
    if (unanswered.length === 0 && 
        currentState.status !== 'waiting_manager' && 
        currentState.status !== 'waiting_user') {
      stopPolling(sessionId);
    }
  }, 500);

  activePollers.set(sessionId, {
    intervalId,
    lastActivity,
    callbacks: { onChange, onAnswer },
  });
}

export function startPolling(sessionId: string): void {
  if (activePollers.has(sessionId)) return;

  const state = readSession(sessionId);
  if (!state) return;

  const unanswered = state.pendingQuestions.filter(q => !q.answer);
  if (unanswered.length === 0) return;

  createPolling(sessionId, globalOnChange || (() => {}), globalOnAnswer || (() => {}));
}

function createPolling(sessionId: string, onChange: PollCallback, onAnswer: AnswerCallback): void {
  // Stop existing poller
  stopPolling(sessionId);

  const state = readSession(sessionId);
  const lastActivity = state?.lastActivity ?? 0;

  const intervalId = setInterval(() => {
    const currentState = readSession(sessionId);
    if (!currentState) {
      stopPolling(sessionId);
      return;
    }

    // Check for new answers
    if (globalOnAnswer) {
      for (const q of currentState.pendingQuestions) {
        if (q.answer && q.answeredAt && q.answeredAt > lastActivity) {
          globalOnAnswer(sessionId, q.id, q.answer);
        }
      }
    }

    // Trigger onChange
    if (globalOnChange) {
      globalOnChange(currentState);
    }

    // Auto-stop if no pending questions
    const unanswered = currentState.pendingQuestions.filter(q => !q.answer);
    if (unanswered.length === 0 && 
        currentState.status !== 'waiting_manager' && 
        currentState.status !== 'waiting_user') {
      stopPolling(sessionId);
    }
  }, 500);

  activePollers.set(sessionId, {
    intervalId,
    lastActivity,
    callbacks: { onChange, onAnswer },
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
// UTILITIES
// ============================================

export function getSessionDir(): string {
  ensureSessionDir();
  return SESSION_DIR;
}