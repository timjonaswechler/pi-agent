// Main entry point for pi-agent extension

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

// Import all modules
import * as session from './session';
import * as spawn from './spawn';
import * as userBridge from './user-bridge';
import * as managerBridge from './manager-bridge';
import * as widget from './widget';
import * as commands from './commands';
import * as askManager from './ask-manager';

// Export types and utilities
export * from './types';
export { session, spawn, userBridge, managerBridge, widget, askManager };

// Active subagents tracking
const activeSubagents = new Map<string, session.SessionState>();

// Event emitter for bridge events
type BridgeEventHandler = (event: import('./types').BridgeEvent) => void;
const eventHandlers: BridgeEventHandler[] = [];

export function onBridgeEvent(handler: BridgeEventHandler): void {
  eventHandlers.push(handler);
}

function emitBridgeEvent(event: import('./types').BridgeEvent): void {
  eventHandlers.forEach(handler => handler(event));
}

export function registerExtension(api: ExtensionAPI): void {
  // Register commands
  commands.register(api);

  // Register tools
  api.registerTool({
    name: 'spawn_interactive_subagent',
    description: 'Spawn a subagent that can communicate with user or manager',
    params: Type.Object({
      agentName: Type.String(),
      task: Type.String(),
      mode: Type.Union([Type.Literal('user'), Type.Literal('manager')]),
      managerSessionId: Type.Optional(Type.String()),
    }),
    handler: async (params) => {
      const { agentName, task, mode, managerSessionId } = params;
      const subagentState = spawn.spawnSubagent(agentName, task, mode, managerSessionId);
      activeSubagents.set(subagentState.sessionId, subagentState);

      // Start polling for this subagent's session file
      startSubagentPolling(subagentState.sessionId, api);

      emitBridgeEvent({
        type: 'subagent_complete', // placeholder
        subagentId: subagentState.subagentId,
        payload: subagentState,
        timestamp: Date.now(),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Spawned subagent: ${subagentState.subagentId}`,
          },
        ],
      };
    },
  });

  // Register ask_manager_question tool
  askManager.register(api, (sessionId, question) => {
    managerBridge.handleManagerQuestion(sessionId, question, api);
  });

  // Register widget
  api.onEvent('session_start', () => {
    widget.registerWidget(api);
  });

  // Cleanup on session shutdown
  api.onEvent('session_shutdown', () => {
    activeSubagents.clear();
    session.stopAllPolling();
    eventHandlers.length = 0;
  });
}

// ============================================
// POLLING LOGIC
// ============================================

const POLL_INTERVAL_MS = 1000; // Poll every 1 second

function startSubagentPolling(sessionId: string, api: ExtensionAPI): void {
  session.startPolling(sessionId, {
    intervalMs: POLL_INTERVAL_MS,
    onChange: (state, changed) => {
      // Update widget with new state
      widget.updateSubagentStatus(sessionId, {
        id: sessionId,
        name: state.subagentId,
        status: mapStatus(state.status),
        lastQuestion: state.pendingQuestions[state.pendingQuestions.length - 1]?.question,
        elapsed: Date.now() - state.lastActivity,
      });

      // If there are pending user questions, show widget
      const userQuestion = state.pendingQuestions.find(q => q.type === 'user' && !q.answer);
      if (userQuestion) {
        userBridge.handleUserQuestion(sessionId, userQuestion, api);
      }
    },
    onAnswer: (questionId, answer) => {
      // Notify that an answer is available
      emitBridgeEvent({
        type: 'answer_received',
        subagentId: sessionId,
        payload: { questionId, answer },
        timestamp: Date.now(),
      });
    },
  });
}

function mapStatus(status: session.SessionState['status']): 'idle' | 'running' | 'waiting' | 'done' | 'error' {
  switch (status) {
    case 'waiting_manager':
    case 'waiting_user':
      return 'waiting';
    case 'complete':
      return 'done';
    case 'error':
      return 'error';
    default:
      return status as 'idle' | 'running';
  }
}

export default registerExtension;