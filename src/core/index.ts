// ============================================
// UNIFIED PI-AGENT
// ============================================
//
// Unified subagent orchestration for Pi.
//
// Commands: /agent, /team, /list, /kill
// Tools: run_subagents, ask_manager_question, answer_manager_question
// Bridge: ask_user_question via existing extension
//
// ============================================

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import * as spawn from './spawn/index.ts';
import { Text } from '@mariozechner/pi-tui';
import * as session from './session/index.ts';
import * as commands from './teams/index.ts';
import * as tools from './tools/index.ts';
import * as managerBridge from './bridge/manager.ts';

// Types
export * from './types.ts';

// ============================================
// EVENT HANDLING
// ============================================

type BridgeEventHandler = (event: import('./types').BridgeEvent) => void;
const eventHandlers: BridgeEventHandler[] = [];

export function onBridgeEvent(handler: BridgeEventHandler): void {
  eventHandlers.push(handler);
}

function emitBridgeEvent(event: import('./types').BridgeEvent): void {
  eventHandlers.forEach(handler => handler(event));
}

// ============================================
// CONTEXT FILTERING
// ============================================
//
// Filter subagent results from context to keep it clean.
// Full results are stored in session files for access if needed.
// ============================================

function registerContextFiltering(api: ExtensionAPI): void {
  api.on('context', async (event) => {
    // Filter out agent-result messages to keep context clean
    const filteredMessages = event.messages.filter(
      (m) => m.customType !== 'agent-result'
    );
    return { messages: filteredMessages };
  });
}

// ============================================
// MAIN EXTENSION
// ============================================

export function registerExtension(api: ExtensionAPI): void {
  // Register context filtering first
  registerContextFiltering(api);

  // Set up global poll callbacks
  session.setGlobalPollCallbacks(
    // onChange - could update UI here
    (state) => {
      // State changed - could emit update event
    },
    // onAnswer - notify via bridge event
    (sessionId, questionId, answer) => {
      emitBridgeEvent({
        type: 'answer_received',
        sessionId,
        subagentId: 'unknown',
        payload: { questionId, answer },
        timestamp: Date.now(),
      });
    }
  );

  // Register manager bridge event handler
  managerBridge.onManagerEvent((event) => {
    emitBridgeEvent(event);
  });

  // Register commands: /agent, /team, /list, /kill
  commands.registerCommands(api);

  // Register all tools
  tools.registerAllTools(api);

  // Cleanup on session shutdown
  api.on('session_shutdown', () => {
    session.stopAllPolling();
    managerBridge.cleanupManagerBridge();
    eventHandlers.length = 0;
  });

  // Startup notification
  api.on('session_start', async (_event, ctx) => {
    if (ctx?.hasUI) {
      ctx.ui.notify('pi-agent loaded - /agent, /team, /list, /kill', 'info');
    }
  });
}

export default registerExtension;