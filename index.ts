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
  // Set up global poll callbacks (needed for session polling)
  session.setGlobalPollCallbacks(
    // onChange - update widget when session changes
    (state) => {
      widget.updateSubagentStatus(state.sessionId, {
        id: state.sessionId,
        name: state.subagentId,
        status: mapStatus(state.status),
        lastQuestion: state.pendingQuestions[state.pendingQuestions.length - 1]?.question,
        elapsed: Date.now() - state.lastActivity,
      });

      // If there are pending user questions, show widget
      const userQuestion = state.pendingQuestions.find(q => q.type === 'user' && !q.answer);
      if (userQuestion) {
        userBridge.handleUserQuestion(state.sessionId, userQuestion, api);
      }
    },
    // onAnswer - notify when answer is received
    (questionId, answer) => {
      emitBridgeEvent({
        type: 'answer_received',
        subagentId: 'unknown',
        payload: { questionId, answer },
        timestamp: Date.now(),
      });
    }
  );

  // Register commands
  commands.register(api);

  // Register all tools
  registerTools(api);

  // Register widget
  api.onEvent('session_start', () => {
    widget.registerWidget(api);
  });

  // Cleanup on session shutdown
  api.onEvent('session_shutdown', () => {
    activeSubagents.clear();
    session.stopAllPolling();
    managerBridge.cleanupManagerBridge();
    eventHandlers.length = 0;
  });
}

// ============================================
// TOOL REGISTRATION
// ============================================

function registerTools(api: ExtensionAPI): void {
  // Tool: Spawn interactive subagent
  api.registerTool({
    name: 'spawn_interactive_subagent',
    description: 'Spawn a subagent that can communicate with user or manager',
    params: Type.Object({
      agentName: Type.String({ description: 'Name of the agent to spawn' }),
      task: Type.String({ description: 'Task for the subagent' }),
      mode: Type.Union([
        Type.Literal('user'),
        Type.Literal('manager'),
      ], { description: 'user=direct to user, manager=via manager' }),
      managerSessionId: Type.Optional(Type.String({ description: 'Parent session ID for manager mode' })),
    }),
    handler: async (params) => {
      const { agentName, task, mode, managerSessionId } = params;
      
      // Spawn the subagent
      const subagentState = spawn.spawnSubagent(agentName, task, mode, managerSessionId);
      activeSubagents.set(subagentState.sessionId, subagentState);

      // If manager mode, track it
      if (mode === 'manager') {
        managerBridge.setManagerMode(subagentState.sessionId, true);
      }

      emitBridgeEvent({
        type: 'subagent_complete',
        subagentId: subagentState.subagentId,
        payload: subagentState,
        timestamp: Date.now(),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Spawned subagent: ${subagentState.sessionId} (${agentName}, mode: ${mode})`,
          },
        ],
      };
    },
  });

  // Register ask_manager_question tool
  askManager.register(api, (sessionId, question) => {
    managerBridge.handleManagerQuestion(sessionId, question, api);
  });

  // Register manager bridge tools
  managerBridge.registerManagerBridge(api);
}

// ============================================
// STATUS MAPPING
// ============================================

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