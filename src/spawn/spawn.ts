// Subagent spawning logic

import { spawn as childSpawn } from 'child_process';
import { join } from 'path';
import * as session from '../session/session';
import type { SubagentConfig } from '../types';

export interface SpawnResult {
  sessionId: string;
  subagentId: string;
  process: import('child_process').ChildProcess;
}

export function spawnSubagent(
  agentName: string,
  task: string,
  mode: 'user' | 'manager',
  parentSessionId?: string
): session.SessionState {
  // Create session for this subagent
  const state = session.createSession(agentName);

  // Build the command
  const args = [
    '--mode', 'json',
    '--session', state.sessionId,
    '--agent', agentName,
    '--interactive-bridge', // Flag to enable bridge mode
  ];

  if (mode === 'manager') {
    args.push('--parent-session', parentSessionId || '');
  }

  // Spawn the subprocess
  const proc = childSpawn('pi', args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_INTERACTIVE_BRIDGE: 'true',
      PI_BRIDGE_SESSION_ID: state.sessionId,
    },
  });

  // Forward task via stdin
  proc.stdin?.write(`${task}\n`);
  proc.stdin?.end();

  // Handle output
  proc.stdout?.on('data', (data) => {
    handleSubagentOutput(state.sessionId, data.toString());
  });

  proc.stderr?.on('data', (data) => {
    console.error(`[${agentName}] stderr:`, data.toString());
  });

  proc.on('exit', (code) => {
    session.readSession(state.sessionId);
    // Update state to complete
  });

  return state;
}

function handleSubagentOutput(sessionId: string, data: string): void {
  // Parse output looking for ask_* calls
  try {
    const lines = data.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'ask_user_question' || parsed.type === 'ask_manager_question') {
          const question = parsed.question || parsed.payload?.question || '';
          session.addQuestion(sessionId, {
            id: parsed.id || `q-${Date.now()}`,
            type: parsed.type === 'ask_manager_question' ? 'manager' : 'user',
            question,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Not JSON, ignore
      }
    }
  } catch {
    // Parse error, ignore
  }
}