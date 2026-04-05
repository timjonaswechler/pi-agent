// Slash commands for interactive-team

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

export function register(api: ExtensionAPI): void {
  // /sub - spawn interactive subagent
  api.registerCommand({
    name: 'sub',
    description: 'Spawn an interactive subagent',
    params: Type.Object({
      agent: Type.String({ description: 'Agent name (e.g., researcher, worker)' }),
      task: Type.String({ description: 'Task for the subagent' }),
      mode: Type.Optional(Type.Union([
        Type.Literal('user'),
        Type.Literal('manager'),
      ])),
    }),
    handler: async (params) => {
      const mode = params.mode || 'user';
      // This triggers the spawn_interactive_subagent tool
      return {
        content: [
          {
            type: 'text',
            text: `Spawning ${params.agent} in ${mode} mode...`,
          },
        ],
      };
    },
  });

  // /sublist - list active subagents
  api.registerCommand({
    name: 'sublist',
    description: 'List active subagents',
    params: Type.Object({}),
    handler: async () => {
      // This would query active subagents and display them
      return {
        content: [
          {
            type: 'text',
            text: 'Active subagents: (not yet implemented)',
          },
        ],
      };
    },
  });

  // /subkill - kill a subagent
  api.registerCommand({
    name: 'subkill',
    description: 'Kill an active subagent',
    params: Type.Object({
      sessionId: Type.String(),
    }),
    handler: async (params) => {
      // This would kill the subprocess and cleanup
      return {
        content: [
          {
            type: 'text',
            text: `Killing subagent ${params.sessionId}...`,
          },
        ],
      };
    },
  });
}