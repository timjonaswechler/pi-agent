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
// ORCHESTRATION ROOT ID
// ============================================
//
// Every Pi window gets a stable root id used to scope session queries so two
// concurrent windows never see each other's runs. Children inherit it via the
// PI_AGENT_ROOT_SESSION_ID env var.
// ============================================

let cachedRootId: string | null = null;

export function getOrchestrationRootId(): string {
  const fromEnv = process.env.PI_AGENT_ROOT_SESSION_ID;
  if (fromEnv) return fromEnv;
  if (!cachedRootId) {
    cachedRootId = `root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return cachedRootId;
}

export function resetOrchestrationRootIdForTests(): void {
  cachedRootId = null;
}

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

export function createSession(
  subagentId: string,
  agentProfile?: string,
  parentSessionId?: string,
  metadata?: Pick<SessionState, 'spawnType' | 'teamName' | 'rootSessionId'>,
): SessionState {
  const sessionId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rootSessionId = metadata?.rootSessionId ?? getOrchestrationRootId();
  const state: SessionState = {
    sessionId,
    subagentId,
    agentProfile,
    spawnType: metadata?.spawnType,
    teamName: metadata?.teamName,
    status: 'idle',
    pendingQuestions: [],
    parentSessionId,
    rootSessionId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  writeSession(state);
  return state;
}

export function updateSessionStatus(
  sessionId: string,
  status: SessionStatus,
  reason?: string,
): void {
  const state = readSession(sessionId);
  if (state) {
    state.status = status;
    if (reason !== undefined) state.reason = reason;
    state.lastActivity = Date.now();
    writeSession(state);
  }
}

export function setSessionPid(sessionId: string, pid: number): void {
  const state = readSession(sessionId);
  if (state) {
    state.pid = pid;
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
    spawnType: state.spawnType,
    teamName: state.teamName,
    agentProfile: state.agentProfile,
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

export interface PendingManagerQuestion {
  sessionId: string;
  subagentId: string;
  spawnType?: SessionState['spawnType'];
  teamName?: string;
  agentProfile?: string;
  rootSessionId: string;
  question: PendingQuestion;
}

/**
 * List pending manager questions. If rootSessionId is provided, only runs
 * whose rootSessionId matches are returned — this is the default for tool
 * and poller callers, so two Pi windows never see each other's runs.
 */
export function getAllPendingManagerQuestions(
  rootSessionId?: string,
): PendingManagerQuestion[] {
  const results: PendingManagerQuestion[] = [];

  ensureSessionDir();

  try {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sessionId = file.replace('.json', '');
      const state = readSession(sessionId);
      if (!state || state.status === 'killed' || state.status === 'timeout') continue;
      if (rootSessionId && state.rootSessionId !== rootSessionId) continue;

      const managerQuestions = state.pendingQuestions.filter(
        q => q.type === 'manager' && !q.answer
      );

      for (const question of managerQuestions) {
        results.push({
          sessionId,
          subagentId: state.subagentId,
          spawnType: state.spawnType,
          teamName: state.teamName,
          agentProfile: state.agentProfile,
          rootSessionId: state.rootSessionId,
          question,
        });
      }
    }
  } catch (err) {
    console.error('[pi-agent] Failed to read session directory:', err);
  }

  return results;
}

/**
 * List every session file whose rootSessionId matches. Used by /list and /kill
 * so each window only touches its own runs.
 */
export function listSessionsByRoot(rootSessionId: string): SessionState[] {
  const sessions: SessionState[] = [];
  ensureSessionDir();

  try {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.replace('.json', '');
      const state = readSession(sid);
      if (state && state.rootSessionId === rootSessionId) {
        sessions.push(state);
      }
    }
  } catch (err) {
    console.error('[pi-agent] Failed to read session directory:', err);
  }

  return sessions;
}

// ============================================
// STARTUP ORPHAN REAP
// ============================================
//
// After a crash, session files linger with no live process. On startup we
// mark those as 'orphaned' and remove them. A PID is considered dead if
// process.kill(pid, 0) throws ESRCH.
// ============================================

export function reapOrphanSessions(): number {
  ensureSessionDir();

  let reaped = 0;
  try {
    const files = readdirSync(SESSION_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.replace('.json', '');
      const state = readSession(sid);
      if (!state) continue;

      const terminal =
        state.status === 'complete' ||
        state.status === 'killed' ||
        state.status === 'timeout' ||
        state.status === 'error' ||
        state.status === 'orphaned';

      if (terminal) {
        deleteSession(sid);
        continue;
      }

      const pid = state.pid;
      const alive = typeof pid === 'number' && isProcessAlive(pid);
      if (!alive) {
        state.status = 'orphaned';
        state.reason = 'parent_crashed';
        writeSession(state);
        deleteSession(sid);
        reaped++;
      }
    }
  } catch (err) {
    console.error('[pi-agent] Orphan reap failed:', err);
  }

  return reaped;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// BLOCKING WAIT FOR ANSWER
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
  timeoutMs: number = 10 * 60 * 1000,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }

    const deadline = Date.now() + timeoutMs;

    const intervalId = setInterval(() => {
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

    signal?.addEventListener('abort', () => {
      clearInterval(intervalId);
      resolve(null);
    }, { once: true });
  });
}

// ============================================
// UTILITIES
// ============================================

export function getSessionDir(): string {
  ensureSessionDir();
  return SESSION_DIR;
}
