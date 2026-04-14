// ============================================
// SUBAGENT SPAWNING + AWAITING RESULTS
// ============================================

import { spawn as childSpawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import * as session from '../session/index.ts';
import { getBuiltInTeamsRoot, getLeaderDirSearchPaths, getMemberDirSearchPaths, getExtensionRoot } from '../teams/paths.ts';

const __filename = fileURLToPath(import.meta.url);
// src/features/sub-agent/index.ts → src/features/ → src/ → extension root
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
  spawnType?: 'solo' | 'team';
  teamName?: string;
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
  const {
    cwd,
    agent,
    mode = 'user',
    spawnType = 'solo',
    teamName,
    parentSessionId,
    timeoutMs = 5 * 60 * 1000,
  } = options;

  // Create session for tracking
  const state = session.createSession(agent || 'default', agent, parentSessionId, {
    spawnType,
    teamName,
  });
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

    // Extra env vars populated by the agent block below
    const childEnvExtras: Record<string, string> = {};

    // Append agent system prompt and effective tools if provided
    if (agent) {
      const agentInfo = getAgentInfo(agent, cwd);
      const requiredOrchestrationTools = mode === 'manager' ? ['ask_manager_question'] : [];
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
      // Tell the extension which session file to use for ask_manager_question
      PI_AGENT_SESSION_ID: sessionId,
      // Pass the process timeout so waitForAnswer uses a consistent deadline
      PI_AGENT_TIMEOUT_MS: String(timeoutMs),
      ...childEnvExtras,
    };

    const proc = childSpawn('pi', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
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
        session.deleteSession(sessionId);
        const output = extractFinalText(stdoutBuf);
        resolve({ sessionId, agent: agent || 'default', task, success: true, output, elapsedMs, pendingQuestions });
      } else if (proc.killed) {
        session.updateSessionStatus(sessionId, 'killed');
        session.deleteSession(sessionId);
        resolve({
          sessionId, agent: agent || 'default', task, success: false,
          output: '', error: `Timed out after ${timeoutMs}ms`, elapsedMs, pendingQuestions,
        });
      } else {
        session.updateSessionStatus(sessionId, 'error');
        session.deleteSession(sessionId);
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
      session.deleteSession(sessionId);
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

interface StreamMessage {
  role: string;
  content?: Array<{ type: string; text?: string }>;
}

function extractFinalText(stdout: string): string {
  const lines = stdout.split('\n').filter(Boolean);
  // Walk backwards looking for agent_end
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as { type?: string; messages?: StreamMessage[] };
      if (event.type === 'agent_end') {
        const messages = event.messages ?? [];
        // Find the last assistant message with text content
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
  // Fallback: concatenate all text_delta events
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

export function killSubagent(sessionId: string): boolean {
  const proc = activeProcesses.get(sessionId);
  if (proc && !proc.killed) {
    proc.kill();
    // Status update + cleanup happen in the 'close' handler after the process exits
    return true;
  }
  return false;
}

export function getActiveSubagents(): string[] {
  return Array.from(activeProcesses.keys());
}
