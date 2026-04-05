// Main entry point for interactive-team extension

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

  // Cleanup on session end
  api.onEvent('session_end', () => {
    activeSubagents.clear();
    eventHandlers.length = 0;
  });
}

export default registerExtension;