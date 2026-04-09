// ============================================
// SUBAGENT SPAWNING + AWAITING RESULTS
// ============================================

import { spawn as childSpawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as session from '../session/index.ts';

const __filename = fileURLToPath(import.meta.url);
// src/features/sub-agent/index.ts → src/features/ → src/ → extension root
const extRoot = dirname(dirname(dirname(dirname(__filename))));

// ============================================
// AGENT FILE LOADING
// ============================================

export function findAgentFile(agentName: string, cwd: string): string | null {
  const parts = agentName.split('/');
  const home = process.env.HOME || '';

  const searchPaths: string[] = [
    // Highest precedence first
    // Local leaders
    join(cwd, '.pi', 'teams', 'leaders', `${agentName}.md`),
    // Global leaders
    join(home, '.pi', 'teams', 'leaders', `${agentName}.md`),
    // Built-in leaders
    join(extRoot, 'teams', 'leaders', `${agentName}.md`),
    // Local agents
    join(cwd, '.pi', 'agents', `${agentName}.md`),
    // Global agents
    join(home, '.pi', 'agents', `${agentName}.md`),
  ];

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        if (!statSync(path).isDirectory()) return path;
      } catch {}
    }
  }
  return null;
}

export function extractSystemPrompt(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1].trim() : content;
}

export interface AgentInfo {
  name: string;
  filePath: string;
  description: string | null;
  systemPrompt: string;
}

export function getAgentInfo(agentName: string, cwd: string): AgentInfo | null {
  const filePath = findAgentFile(agentName, cwd);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const descMatch = content.match(/^description:\s*(.+)/im);
    const description = descMatch ? descMatch[1].trim() : null;
    const bodyMatch = content.match(/^---\n[\s\S]*?---\n([\s\S]*)$/);
    const systemPrompt = bodyMatch ? bodyMatch[1].trim() : content;
    return { name: agentName, filePath, description, systemPrompt };
  } catch {
    return null;
  }
}

// ============================================
// RESULT TYPE
// ============================================

export interface SubagentResult {
  sessionId: string;
  agent: string;
  task: string;
  success: boolean;
  /** Final assistant text from the subagent's last message */
  output: string;
  /** Any error message */
  error?: string;
  elapsedMs: number;
  /** Questions the subagent asked the manager (if any) */
  pendingQuestions: Array<{ questionId: string; question: string }>;
}

// ============================================
// SPAWN + AWAIT
// ============================================

export interface SpawnOptions {
  cwd: string;
  agent?: string;
  /** user = subagent can ask_user_question (needs TUI - usually not available)
   *  manager = subagent asks manager via ask_manager_question */
  mode?: 'user' | 'manager';
  parentSessionId?: string;
  timeoutMs?: number;
}

// Track active processes for kill support
const activeProcesses = new Map<string, ReturnType<typeof childSpawn>>();

/**
 * Spawn a subagent and wait for it to complete.
 * Returns a promise that resolves with the final output.
 */
export function spawnAndAwait(
  task: string,
  options: SpawnOptions,
  onProgress?: (msg: string) => void,
): { sessionId: string; promise: Promise<SubagentResult> } {
  const { cwd, agent, mode = 'user', parentSessionId, timeoutMs = 5 * 60 * 1000 } = options;

  // Create session for tracking
  const state = session.createSession(agent || 'default', agent, parentSessionId);
  session.updateSessionStatus(state.sessionId, 'running');

  const startTime = Date.now();
  const sessionId = state.sessionId;

  const promise = new Promise<SubagentResult>((resolve) => {
    // ── Build pi args ──────────────────────────────────────────────────────
    const args: string[] = [
      '--mode', 'json',
      '--no-session',       // ephemeral — don't pollute session history
      '-e', join(extRoot, 'src', 'index.ts'),  // load the public extension entry once
    ];

    // Append agent system prompt if provided
    if (agent) {
      const agentFile = findAgentFile(agent, cwd);
      if (agentFile) {
        const prompt = extractSystemPrompt(agentFile);
        if (prompt) {
          args.push('--append-system-prompt', prompt);
        }
      }
    }

    args.push('-p', `[TASK]: ${task}`);

    // ── Spawn ──────────────────────────────────────────────────────────────
    const proc = childSpawn('pi', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Tell the extension which session file to use for ask_manager_question
        PI_AGENT_SESSION_ID: sessionId,
      },
    });

    activeProcesses.set(sessionId, proc);

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;

      // Stream progress: surface tool calls and question events
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'tool_execution_start') {
            onProgress?.(`[${agent || 'agent'}] calling ${event.toolName}`);
            // If subagent is asking manager a question, surface it
            if (event.toolName === 'ask_manager_question') {
              onProgress?.(
                `[${agent || 'agent'}] ❓ question: ${event.args?.question ?? ''}`,
              );
            }
          }
        } catch {}
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    // ── Timeout ────────────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      if (!proc.killed) proc.kill();
    }, timeoutMs);

    // ── Exit handler ───────────────────────────────────────────────────────
    proc.on('close', (code) => {
      clearTimeout(timer);
      activeProcesses.delete(sessionId);

      const elapsedMs = Date.now() - startTime;
      const pendingQuestions = getPendingQuestionsFromSession(sessionId);
      const success = code === 0;

      if (success) {
        session.updateSessionStatus(sessionId, 'complete');
        const output = extractFinalText(stdoutBuf);
        resolve({ sessionId, agent: agent || 'default', task, success: true, output, elapsedMs, pendingQuestions });
      } else if (proc.killed) {
        session.updateSessionStatus(sessionId, 'killed');
        resolve({
          sessionId, agent: agent || 'default', task, success: false,
          output: '', error: `Timed out after ${timeoutMs}ms`, elapsedMs, pendingQuestions,
        });
      } else {
        session.updateSessionStatus(sessionId, 'error');
        resolve({
          sessionId, agent: agent || 'default', task, success: false,
          output: '', error: stderrBuf || `Exit code ${code}`, elapsedMs, pendingQuestions,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcesses.delete(sessionId);
      session.updateSessionStatus(sessionId, 'error');
      resolve({
        sessionId, agent: agent || 'default', task, success: false,
        output: '', error: err.message, elapsedMs: Date.now() - startTime, pendingQuestions: [],
      });
    });
  });

  return { sessionId, promise };
}

// ============================================
// PARSE agent_end → final assistant text
// ============================================

function extractFinalText(stdout: string): string {
  const lines = stdout.split('\n').filter(Boolean);
  // Walk backwards looking for agent_end
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === 'agent_end') {
        const messages: any[] = event.messages ?? [];
        // Find the last assistant message with text content
        for (let j = messages.length - 1; j >= 0; j--) {
          const msg = messages[j];
          if (msg.role === 'assistant') {
            const text = (msg.content ?? [])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text as string)
              .join('');
            if (text) return text;
          }
        }
      }
    } catch {}
  }
  // Fallback: concatenate all text_delta events
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        texts.push(event.assistantMessageEvent.delta ?? '');
      }
    } catch {}
  }
  return texts.join('') || '(no output)';
}

function getPendingQuestionsFromSession(sessionId: string): Array<{ questionId: string; question: string }> {
  const state = session.readSession(sessionId);
  if (!state) return [];
  return state.pendingQuestions
    .filter((q) => q.type === 'manager' && !q.answer)
    .map((q) => ({ questionId: q.id, question: q.question }));
}

// ============================================
// KILL
// ============================================

export function killSubagent(sessionId: string): boolean {
  const proc = activeProcesses.get(sessionId);
  if (proc && !proc.killed) {
    proc.kill();
    session.updateSessionStatus(sessionId, 'killed');
    return true;
  }
  return false;
}

export function getActiveSubagents(): string[] {
  return Array.from(activeProcesses.keys());
}
