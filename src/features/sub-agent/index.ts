// ============================================
// SUBAGENT SPAWNING + AWAITING RESULTS
// ============================================

import { spawn as childSpawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import * as session from '../session/index.ts';
import { getLeaderDirSearchPaths, getMemberDirSearchPaths, getExtensionRoot } from '../../shared/paths.ts';
import type { SubagentResult } from '../../core/types.ts';
export type { SubagentResult };

const extRoot = getExtensionRoot();
const BUILTIN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
const SPAWNED_SUBAGENT_CLARIFICATION_POLICY = `
[SPAWNED SUBAGENT COMMUNICATION POLICY]
You are a spawned subagent running in a child session.
You do not communicate with the end user directly.
You communicate only through the parent orchestration session.

If the task requires information from a human, requires clarification, or asks you to ask a question, you must use the ask_manager_question tool instead of writing the question as normal assistant text.

Use ask_manager_question when:
- required information is missing
- the task asks you to ask the user something
- a clarification is necessary before continuing
- correctness depends on a human answer

Ask exactly one concise question when needed.
If the ambiguity is minor and does not block correctness, state your assumption briefly and continue.
Do not invent missing requirements when a clarification is necessary for correctness.
Do not ask the end user directly in plain text.
`;

// ============================================
// AGENT FILE LOADING
// ============================================

export function findAgentFile(agentName: string, cwd: string): string | null {
  const searchPaths: string[] = [
    ...getLeaderDirSearchPaths(cwd).map((dir) => join(dir, `${agentName}.md`)),
    ...getMemberDirSearchPaths(cwd).map((dir) => join(dir, `${agentName}.md`)),
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

export interface AgentInfo {
  name: string;
  filePath: string;
  description: string | null;
  systemPrompt: string;
  tools?: string[];
  model?: string;
}

function parseAgentMarkdown(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const frontmatter = (yaml.load(match[1]) as Record<string, unknown> | undefined) ?? {};
  return {
    frontmatter,
    body: match[2].trim(),
  };
}

function parseAgentTools(frontmatter: Record<string, unknown>): string[] | undefined {
  const rawTools = typeof frontmatter.tools === 'string'
    ? frontmatter.tools
    : typeof frontmatter.tool === 'string'
      ? frontmatter.tool
      : undefined;

  if (!rawTools) return undefined;

  const tools = rawTools
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);

  return tools.length > 0 ? tools : undefined;
}

export function getAgentInfo(agentName: string, cwd: string): AgentInfo | null {
  const filePath = findAgentFile(agentName, cwd);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseAgentMarkdown(content);
    const description = typeof frontmatter.description === 'string' ? frontmatter.description : null;
    const model = typeof frontmatter.model === 'string' ? frontmatter.model : undefined;
    const tools = parseAgentTools(frontmatter);

    return {
      name: agentName,
      filePath,
      description,
      systemPrompt: body,
      tools,
      model,
    };
  } catch {
    return null;
  }
}

// ============================================
// SPAWN + AWAIT
// ============================================

export interface SpawnOptions {
  cwd: string;
  agent?: string;
  /** manager = subagent asks its manager via ask_manager_question (only supported mode today) */
  mode: 'manager';
  spawnType?: 'solo' | 'team';
  teamName?: string;
  parentSessionId?: string;
  rootSessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

// Track active processes for kill support
const activeProcesses = new Map<string, ReturnType<typeof childSpawn>>();
// Intended termination reason, set before signalling the child
const terminationReasons = new Map<string, { status: 'killed' | 'timeout'; reason: string }>();

/**
 * Spawn a subagent and wait for it to complete.
 * Returns a promise that resolves with the final output.
 */
export function spawnAndAwait(
  task: string,
  options: SpawnOptions,
  onProgress?: (msg: string) => void,
): { sessionId: string; promise: Promise<SubagentResult> } {
  const {
    cwd,
    agent,
    spawnType = 'solo',
    teamName,
    parentSessionId,
    rootSessionId,
    timeoutMs = 5 * 60 * 1000,
    signal,
  } = options;

  const resolvedRootId = rootSessionId ?? session.getOrchestrationRootId();

  const state = session.createSession(agent || 'default', agent, parentSessionId, {
    spawnType,
    teamName,
    rootSessionId: resolvedRootId,
  });
  session.updateSessionStatus(state.sessionId, 'running');

  const startTime = Date.now();
  const sessionId = state.sessionId;

  const promise = new Promise<SubagentResult>((resolve) => {
    // Short-circuit if already aborted before spawn
    if (signal?.aborted) {
      session.updateSessionStatus(sessionId, 'killed', 'cancelled_by_signal');
      session.deleteSession(sessionId);
      resolve({
        sessionId, agent: agent || 'default', task, success: false,
        output: '', error: 'Aborted before spawn', reason: 'cancelled_by_signal',
        elapsedMs: 0, pendingQuestions: [],
      });
      return;
    }

    // ── Build pi args ──────────────────────────────────────────────────────
    const args: string[] = [
      '--mode', 'json',
      '--no-session',
      '-e', join(extRoot, 'src', 'index.ts'),
    ];

    const childEnvExtras: Record<string, string> = {};

    if (agent) {
      const agentInfo = getAgentInfo(agent, cwd);
      const requiredOrchestrationTools = ['ask_manager_question'];
      const effectiveTools = Array.from(
        new Set([...(agentInfo?.tools ?? []), ...requiredOrchestrationTools]),
      );

      if (agentInfo?.systemPrompt) {
        const effectivePrompt = `${agentInfo.systemPrompt}\n\n${SPAWNED_SUBAGENT_CLARIFICATION_POLICY}`.trim();
        args.push('--append-system-prompt', effectivePrompt);
      }

      const builtinTools = effectiveTools.filter((tool) => BUILTIN_TOOLS.has(tool));
      if (builtinTools.length > 0) {
        args.push('--tools', builtinTools.join(','));
      }

      if (effectiveTools.length > 0) {
        childEnvExtras.PI_AGENT_ACTIVE_TOOLS = effectiveTools.join(',');
      }
    }

    args.push('-p', `[TASK]: ${task}`);

    // ── Spawn ──────────────────────────────────────────────────────────────
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      PI_AGENT_SESSION_ID: sessionId,
      PI_AGENT_ROOT_SESSION_ID: resolvedRootId,
      PI_AGENT_TIMEOUT_MS: String(timeoutMs),
      ...childEnvExtras,
    };

    const proc = childSpawn('pi', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    activeProcesses.set(sessionId, proc);
    if (typeof proc.pid === 'number') {
      session.setSessionPid(sessionId, proc.pid);
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;

      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'tool_execution_start') {
            onProgress?.(`[${agent || 'agent'}] calling ${event.toolName}`);
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
      if (proc.exitCode !== null) return;
      terminationReasons.set(sessionId, { status: 'timeout', reason: 'timeout_elapsed' });
      session.updateSessionStatus(sessionId, 'timeout', 'timeout_elapsed');
      sendTerm(proc);
    }, timeoutMs);

    // ── Abort signal forwarding ────────────────────────────────────────────
    const onAbort = () => {
      if (proc.exitCode !== null) return;
      terminationReasons.set(sessionId, {
        status: 'killed',
        reason: 'cancelled_by_signal',
      });
      session.updateSessionStatus(sessionId, 'killed', 'cancelled_by_signal');
      sendTerm(proc);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // ── Exit handler ───────────────────────────────────────────────────────
    proc.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      activeProcesses.delete(sessionId);
      const termInfo = terminationReasons.get(sessionId);
      terminationReasons.delete(sessionId);

      const elapsedMs = Date.now() - startTime;
      const pendingQuestions = getPendingQuestionsFromSession(sessionId);

      if (termInfo?.status === 'timeout') {
        session.deleteSession(sessionId);
        resolve({
          sessionId, agent: agent || 'default', task, success: false,
          output: '', error: `Timed out after ${timeoutMs}ms`, reason: termInfo.reason,
          elapsedMs, pendingQuestions,
        });
        return;
      }

      if (termInfo?.status === 'killed') {
        session.deleteSession(sessionId);
        resolve({
          sessionId, agent: agent || 'default', task, success: false,
          output: '', error: `Cancelled: ${termInfo.reason}`, reason: termInfo.reason,
          elapsedMs, pendingQuestions,
        });
        return;
      }

      if (code === 0) {
        session.updateSessionStatus(sessionId, 'complete');
        session.deleteSession(sessionId);
        const output = extractFinalText(stdoutBuf);
        resolve({
          sessionId, agent: agent || 'default', task, success: true,
          output, elapsedMs, pendingQuestions,
        });
        return;
      }

      session.updateSessionStatus(sessionId, 'error', `exit_code_${code}`);
      session.deleteSession(sessionId);
      resolve({
        sessionId, agent: agent || 'default', task, success: false,
        output: '', error: stderrBuf || `Exit code ${code}`, reason: `exit_code_${code}`,
        elapsedMs, pendingQuestions,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      activeProcesses.delete(sessionId);
      terminationReasons.delete(sessionId);
      session.updateSessionStatus(sessionId, 'error', 'spawn_error');
      session.deleteSession(sessionId);
      resolve({
        sessionId, agent: agent || 'default', task, success: false,
        output: '', error: err.message, reason: 'spawn_error',
        elapsedMs: Date.now() - startTime, pendingQuestions: [],
      });
    });
  });

  return { sessionId, promise };
}

// ============================================
// PARSE agent_end → final assistant text
// ============================================

interface StreamMessage {
  role: string;
  content?: Array<{ type: string; text?: string }>;
}

function extractFinalText(stdout: string): string {
  const lines = stdout.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as { type?: string; messages?: StreamMessage[] };
      if (event.type === 'agent_end') {
        const messages = event.messages ?? [];
        for (let j = messages.length - 1; j >= 0; j--) {
          const msg = messages[j];
          if (msg.role === 'assistant') {
            const text = (msg.content ?? [])
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('');
            if (text) return text;
          }
        }
      }
    } catch {}
  }
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        assistantMessageEvent?: { type?: string; delta?: string };
      };
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

const SIGKILL_GRACE_MS = 3000;

function sendTerm(proc: ReturnType<typeof childSpawn>): void {
  if (proc.exitCode !== null) return;
  try {
    proc.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    if (proc.exitCode === null) {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }
  }, SIGKILL_GRACE_MS);
}

export function killSubagent(sessionId: string, reason = 'cancelled_by_user'): boolean {
  const proc = activeProcesses.get(sessionId);
  if (!proc || proc.exitCode !== null) return false;
  terminationReasons.set(sessionId, { status: 'killed', reason });
  session.updateSessionStatus(sessionId, 'killed', reason);
  sendTerm(proc);
  return true;
}

export function getActiveSubagents(): string[] {
  return Array.from(activeProcesses.keys());
}
