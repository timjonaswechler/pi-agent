// ============================================
// PI-AGENT: UNIFIED SUBAGENT ORCHESTRATION
// ============================================
// 
// A single extension that combines:
// - /agent, /team, /list, /kill commands
// - run_subagents, ask_manager_question tools
// - User and Manager bridge for question handling
// - On-demand polling for session file changes
//
// Usage: pi -e extensions/pi-agent/src/index.ts
// ============================================

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Text, Container } from '@mariozechner/pi-tui';

// Modules
import * as session from './session';
import * as commands from './commands';
import * as tools from './tools';
import * as managerBridge from './bridge/manager';
import * as userBridge from './bridge/user';
import * as spawn from './spawn';

// Types
export * from './types';

// ============================================
// BRIDGE EVENT HANDLING
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
// MAIN EXTENSION
// ============================================

export function registerExtension(api: ExtensionAPI): void {
  // Set up user bridge API reference
  userBridge.setApi(api);

  // Set up global poll callbacks
  session.setGlobalPollCallbacks(
    // onChange - update status
    (state) => {
      // Check for user questions and notify
      const userQuestion = state.pendingQuestions.find(q => q.type === 'user' && !q.answer);
      if (userQuestion) {
        userBridge.handleUserQuestion(state.sessionId, userQuestion);
      }
    },
    // onAnswer - emit event
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

  // Register event handler for manager bridge
  managerBridge.onManagerEvent((event) => {
    emitBridgeEvent(event);
  });

  // Register commands: /agent, /team, /list, /kill
  commands.registerCommands(api);

  // Register all tools
  tools.registerAllTools(api);

  // Register message renderer for agent results
  api.registerMessageRenderer('agent-result', (message, options, theme) => {
    const details = message.details as {
      agent: string;
      task: string;
      output: string;
      error?: string;
    };

    let text = theme.fg('accent', `[Agent: ${details.agent}] `) +
               theme.bold(details.task) + '\n\n';

    if (details.error) {
      text += theme.fg('red', `Error: ${details.error}\n`);
    }

    if (options.expanded) {
      text += theme.fg('dim', details.output.trim());
    } else {
      const lines = details.output.trim().split('\n');
      const preview = lines.slice(0, 3).join('\n');
      text += theme.fg('dim', preview + (lines.length > 3 ? '\n...' : ''));
    }

    return new Text(text, 0, 0);
  });

  // Filter agent-result messages from context to avoid polluting main agent
  api.on('context', async (event, ctx) => {
    const filteredMessages = event.messages.filter(
      (m) => m.customType !== 'agent-result'
    );
    return { messages: filteredMessages };
  });

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

// ============================================
// DEFAULT EXPORT
// ============================================

export default registerExtension;