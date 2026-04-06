// ============================================
// SUBAGENT SPAWNING
// ============================================

import { spawn as childSpawn } from 'child_process';
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as session from '../session/index.ts';
import type { SessionState } from '../types.ts';

// ============================================
// AGENT FILE LOADING
// ============================================

export function findAgentFile(agentName: string, cwd: string): string | null {
  // Support nested paths like "subagent/code-reviewer"
  const parts = agentName.split('/');
  const home = process.env.HOME || '';

  const searchPaths = [
    // Local project agents
    join(cwd, '.pi', 'agents', ...parts.map(p => `${p}.md`)),
    join(cwd, '.pi', 'agents', ...parts.map(p => `${p}`)),
    // Global agents
    join(home, '.pi', 'agents', ...parts.map(p => `${p}.md`)),
    join(home, '.pi', 'agents', ...parts.map(p => `${p}`)),
  ];

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) continue;
        return path;
      } catch {}
    }
  }
  return null;
}

export function extractSystemPrompt(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  // Extract markdown body (after frontmatter)
  const match = content.match(/^---\n[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1].trim() : content;
}

export function getAgentDescription(agentName: string, cwd: string): string | null {
  const filePath = findAgentFile(agentName, cwd);
  if (!filePath) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    // Try to extract description from frontmatter
    const match = content.match(/description:\s*(.+)/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// ============================================
// SUBAGENT EXECUTION
// ============================================

export interface SpawnOptions {
  cwd: string;
  agent?: string;
  mode?: 'user' | 'manager';
  parentSessionId?: string;
  maxRuntimeMs?: number;
}

export interface SpawnResult {
  session: SessionState;
  task: string;
  startTime: number;
}

let activeProcesses = new Map<string, ReturnType<typeof childSpawn>>();

export function spawnSubagent(
  task: string,
  options: SpawnOptions
): SpawnResult {
  const { cwd, agent, mode = 'user', parentSessionId } = options;

  // Create session for tracking
  const state = session.createSession(agent || 'default', agent, parentSessionId);
  state.status = 'running';
  session.writeSession(state);

  // Build arguments for pi subprocess
  const args = ['--mode', 'json'];
  let tempPromptFile: string | null = null;

  // Load and append agent system prompt if available
  if (agent) {
    const agentFile = findAgentFile(agent, cwd);
    if (agentFile) {
      const systemPrompt = extractSystemPrompt(agentFile);
      
      // Add instruction to ask for clarification when needed
      let finalPrompt = systemPrompt;
      finalPrompt += '\n\nIf [TASK] has no clear task or you need more information, ask a clarifying question first. Do NOT make assumptions.';

      // Write to temp file for --append-system-prompt
      tempPromptFile = join(tmpdir(), `pi-agent-${Date.now()}.txt`);
      writeFileSync(tempPromptFile, finalPrompt, 'utf-8');
      args.push('--append-system-prompt', tempPromptFile);
    }
  }

  // Pass the task as prompt
  args.push('-p', `[TASK]: ${task}`);

  // Spawn process
  const proc = childSpawn('pi', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Track the process
  activeProcesses.set(state.sessionId, proc);

  // Handle stdout - look for ask_* calls
  proc.stdout?.on('data', (data) => {
    handleSubagentOutput(state.sessionId, data.toString());
  });

  // Handle stderr
  proc.stderr?.on('data', (data) => {
    console.error(`[${state.subagentId}] stderr:`, data.toString());
  });

  // Handle exit
  proc.on('close', (code) => {
    cleanupProcess(state.sessionId, tempPromptFile, code || 0);
  });

  proc.on('error', (err) => {
    session.updateSessionStatus(state.sessionId, 'error');
    cleanupProcess(state.sessionId, tempPromptFile, 1);
    console.error(`[${state.subagentId}] spawn error:`, err.message);
  });

  // Set up timeout if specified
  if (options.maxRuntimeMs) {
    setTimeout(() => {
      const proc = activeProcesses.get(state.sessionId);
      if (proc && !proc.killed) {
        proc.kill();
        session.updateSessionStatus(state.sessionId, 'killed');
      }
    }, options.maxRuntimeMs);
  }

  return {
    session: state,
    task,
    startTime: Date.now(),
  };
}

function handleSubagentOutput(sessionId: string, data: string): void {
  // Parse JSON lines looking for ask_* calls
  const lines = data.split('\n').filter(l => l.trim());
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      
      // Detect ask_user_question or ask_manager_question calls
      if (event.type === 'tool_execution_start' && event.toolName) {
        if (event.toolName === 'ask_user_question' || event.toolName === 'ask_manager_question') {
          const question = event.params?.question || '';
          const questionType = event.toolName === 'ask_manager_question' ? 'manager' : 'user';
          
          session.addQuestion(sessionId, {
            type: questionType,
            question,
          });
          
          // Start polling since we have a pending question
          session.startPolling(sessionId);
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }
}

function cleanupProcess(sessionId: string, tempPromptFile: string | null, exitCode: number): void {
  // Remove temp file
  if (tempPromptFile) {
    try {
      unlinkSync(tempPromptFile);
    } catch {}
  }

  // Update session status
  const state = session.readSession(sessionId);
  if (state) {
    if (exitCode === 0) {
      state.status = 'complete';
    } else if (state.status !== 'killed') {
      state.status = 'error';
    }
    state.lastActivity = Date.now();
    session.writeSession(state);
  }

  // Remove from active processes
  activeProcesses.delete(sessionId);

  // Stop polling
  session.stopPolling(sessionId);
}

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

export function isSubagentRunning(sessionId: string): boolean {
  const proc = activeProcesses.get(sessionId);
  return proc !== undefined && !proc.killed;
}