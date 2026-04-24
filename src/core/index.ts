// ============================================
// UNIFIED PI-AGENT
// ============================================
//
// Unified subagent orchestration for Pi.
//
// Commands: /agent, /team, /list, /kill
// Tools:    run_subagents, ask_manager_question,
//           answer_manager_question, get_pending_questions,
//           ask_user_question
// ============================================

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

import * as commands from '../features/teams/index.ts';
import * as tools from './tools/index.ts';
import { registerUserInputTools } from '../features/user-input/index.ts';
import { reapOrphanSessions, getOrchestrationRootId } from '../features/session/index.ts';

export * from './types.ts';

// ============================================
// MAIN EXTENSION
// ============================================

export function registerExtension(api: ExtensionAPI): void {
  // Register slash commands: /agent, /team, /list, /kill
  commands.registerCommands(api);

  // Register orchestration tools
  tools.registerAllTools(api);

  // Register ask_user_question (gracefully skipped if already registered
  // by another extension in the same session)
  registerUserInputTools(api);

  const forcedActiveTools = process.env.PI_AGENT_ACTIVE_TOOLS
    ?.split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);

  // Startup notification + orphan reap (only for non-subagent sessions)
  api.on('session_start', async (_event, ctx) => {
    if (forcedActiveTools && forcedActiveTools.length > 0) {
      api.setActiveTools(forcedActiveTools);
    }

    // Only reap in top-level Pi windows, not spawned subagent processes
    if (!process.env.PI_AGENT_SESSION_ID) {
      // Initialize the orchestration root id early so it's stable
      getOrchestrationRootId();
      const reaped = reapOrphanSessions();
      if (reaped > 0) {
        console.error(`[pi-agent] Reaped ${reaped} orphan session(s).`);
      }
    }

    if (ctx?.hasUI) {
      ctx.ui.notify('pi-agent loaded — /agent  /team  /list  /kill', 'info');
    }
  });

  // Filter subagent-result messages from context so they don't clutter
  // the manager's conversation window
  api.on('context', async (event) => {
    const filtered = event.messages.filter(
      (m) => m.customType !== 'agent-result',
    );
    return { messages: filtered };
  });
}

export default registerExtension;
