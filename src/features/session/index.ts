// ============================================
// SESSION MANAGEMENT WITH ON-DEMAND POLLING
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { SessionState, PendingQuestion, SessionStatus } from '../../core/types.ts';
export type { SessionState, PendingQuestion, SessionStatus };

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
// BLOCKING WAIT FOR ANSWER
// ============================================
//
// Used by ask_manager_question in a subagent process:
// writes the question to the session file, then polls
// the file every 500ms until the manager answers.
// ============================================

const POLL_INTERVAL_MS = 500;

/**
 * Poll the session file until the given question has been answered,
 * the signal is aborted, or the timeout is reached.
 *
 * Returns the answer string, or null on timeout/abort.
 */
export function waitForAnswer(
  sessionId: string,
  questionId: string,
  signal?: AbortSignal,
  timeoutMs: number = 10 * 60 * 1000, // 10 min default
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }

    const deadline = Date.now() + timeoutMs;

    const intervalId = setInterval(() => {
      // Abort / timeout check
      if (signal?.aborted || Date.now() > deadline) {
        clearInterval(intervalId);
        resolve(null);
        return;
      }

      const state = readSession(sessionId);
      if (!state) {
        clearInterval(intervalId);
        resolve(null);
        return;
      }

      const question = state.pendingQuestions.find((q) => q.id === questionId);
      if (question?.answer) {
        clearInterval(intervalId);
        resolve(question.answer);
      }
    }, POLL_INTERVAL_MS);

    // Also listen for abort signal
    signal?.addEventListener('abort', () => {
      clearInterval(intervalId);
      resolve(null);
    }, { once: true });
  });
}

// ============================================
// LEGACY POLLING STUBS (kept for compat)
// ============================================

export function startPolling(_sessionId: string): void { /* no-op */ }
export function stopPolling(_sessionId: string): void { /* no-op */ }
export function stopAllPolling(): void { /* no-op */ }
export function isPolling(_sessionId: string): boolean { return false; }
export function setGlobalPollCallbacks(_a: unknown, _b: unknown): void { /* no-op */ }

// ============================================
// UTILITIES
// ============================================

export function getSessionDir(): string {
  ensureSessionDir();
  return SESSION_DIR;
}
