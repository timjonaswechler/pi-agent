// ============================================
// SLASH COMMANDS: /agent, /team, /list, /kill
// ============================================

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Text, SelectList, Container } from '@mariozechner/pi-tui';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as session from '../session/index.ts';
import * as spawn from '../spawn/index.ts';
import * as managerBridge from '../bridge/manager.ts';

// ============================================
// TEAM CONFIG LOADING
// ============================================

interface TeamConfig {
  manager: string;
  members: string[];
  description?: string;
}

type TeamsYaml = Record<string, TeamConfig>;

export function loadTeamsYaml(cwd: string): TeamsYaml | null {
  const searchPaths = [
    join(cwd, '.pi', 'agents', 'teams.yaml'),
    join(process.env.HOME || '', '.pi', 'agents', 'teams.yaml'),
    join(cwd, '.pi', 'agent-team', 'teams.yaml'),
    join(process.env.HOME || '', '.pi', 'agent-team', 'teams.yaml'),
  ];

  let yamlContent: string | null = null;

  for (const path of searchPaths) {
    if (existsSync(path)) {
      yamlContent = readFileSync(path, 'utf-8');
      break;
    }
  }

  if (!yamlContent) return null;

  // Try to detect format and parse accordingly
  if (yamlContent.includes('teams:')) {
    return parseFlatTeamsYaml(yamlContent);
  } else {
    return parseHierarchicalTeamsYaml(yamlContent);
  }
}

function parseHierarchicalTeamsYaml(yamlContent: string): TeamsYaml {
  const teams: TeamsYaml = {};
  let currentTeam: string | null = null;

  for (const line of yamlContent.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    
    const trimmed = line.trim();
    
    if (trimmed.endsWith(':')) {
      currentTeam = trimmed.slice(0, -1).trim();
      teams[currentTeam] = { manager: '', members: [] };
      continue;
    }

    if (!currentTeam) continue;

    if (trimmed.startsWith('manager:')) {
      teams[currentTeam].manager = trimmed.replace('manager:', '').trim();
    } else if (trimmed.startsWith('-')) {
      const member = trimmed.substring(1).trim();
      if (member) teams[currentTeam].members.push(member);
    }
  }

  return teams;
}

function parseFlatTeamsYaml(yamlContent: string): TeamsYaml {
  const teams: TeamsYaml = {};
  let currentTeam: string | null = null;

  for (const line of yamlContent.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    
    const trimmed = line.trim();
    
    // Skip the 'teams:' root key
    if (trimmed === 'teams:') continue;
    
    // Team name (indented, no colon, not starting with dash)
    if (!trimmed.startsWith('-') && !trimmed.includes(':')) {
      currentTeam = trimmed;
      teams[currentTeam] = { manager: '', members: [] };
    } else if (trimmed.startsWith('-') && currentTeam) {
      // Member line
      const member = trimmed.substring(1).trim();
      if (member) teams[currentTeam].members.push(member);
    }
  }

  return teams;
}

// ============================================
// REGISTER COMMANDS
// ============================================

let currentCwd = '';
let teamModeActive = false;
let currentTeamName = '';

export function registerCommands(api: ExtensionAPI): void {
  // Store cwd for agent lookups
  api.on('session_start', async (_event, ctx) => {
    currentCwd = ctx.cwd;
  });

  // ── /agent command ──────────────────────────────────────
  api.registerCommand('agent', {
    description: 'Spawn a sub-agent to execute a task without polluting your session context',
    getArgumentCompletions: (prefix: string) => {
      const agents = getAvailableAgents();
      return agents
        .filter(a => a.startsWith(prefix))
        .map(a => ({ value: a, label: a }));
    },
    handler: async (args, ctx) => {
      const agentName = args?.split(' ')[0] || '';
      const taskDesc = args?.substring(agentName.length).trim() || '';

      // Show agent selection if no args
      if (!args) {
        const agents = getAvailableAgents();
        if (agents.length === 0) {
          ctx.ui.notify('No agents found in ~/.pi/agents/', 'warning');
          return;
        }

        const selected = await showAgentSelect(api, ctx, agents);
        if (!selected) return;
        
        ctx.ui.notify(`Selected: ${selected}. Enter task next.`, 'info');
        return;
      }

      // If only agent name, ask for task
      if (!taskDesc) {
        ctx.ui.notify(`Agent: ${agentName}. Enter task description.`, 'info');
        return;
      }

      // Execute the task
      ctx.ui.notify(`Starting agent '${agentName}'...`, 'info');
      ctx.ui.setStatus('agent', `Running ${agentName}...`);

      try {
        const result = spawn.spawnSubagent(taskDesc, {
          cwd: ctx.cwd,
          agent: agentName,
          mode: teamModeActive ? 'manager' : 'user',
        });

        // Wait for completion (simplified - could be async)
        // For now, just show that it was started
        ctx.ui.notify(`Agent started: ${result.session.sessionId}`, 'success');
        
        // Emit event for tracking
        ctx.ui.setStatus('agent', undefined);
      } catch (error: any) {
        ctx.ui.setStatus('agent', undefined);
        ctx.ui.notify(`Agent failed: ${error.message}`, 'error');
      }
    },
  });

  // ── /team command ──────────────────────────────────────
  api.registerCommand('team', {
    description: 'Activate Team Mode for orchestrating multiple agents',
    handler: async (args, ctx) => {
      const teams = loadTeamsYaml(ctx.cwd);

      if (!teams) {
        ctx.ui.notify('No teams.yaml found', 'warning');
        return;
      }

      // Toggle off if active
      if (teamModeActive) {
        teamModeActive = false;
        currentTeamName = '';
        ctx.ui.notify('Team Mode deactivated', 'info');
        ctx.ui.setStatus('team', undefined);
        return;
      }

      // Show team selection
      const teamEntries = Object.entries(teams).map(([name, config]) => ({
        label: `${name} (${config.members.length} members)`,
        value: name,
      }));

      const selected = await showTeamSelect(api, ctx, teamEntries);
      if (!selected) return;

      teamModeActive = true;
      currentTeamName = selected;
      ctx.ui.setStatus('team', `Team: ${selected}`);

      // Inject team context as system message
      const team = teams[selected];
      const memberList = team.members.join(', ');
      
      api.sendMessage({
        role: 'system',
        content: `[TEAM MODE] You are now the Team Manager for "${selected}".\n\nAvailable team members: ${memberList}\n\nUse run_subagents to delegate tasks.`,
      }, { deliverAs: 'context' });
    },
  });

  // ── /list command ──────────────────────────────────────
  api.registerCommand('list', {
    description: 'List active sub-agents with their status',
    handler: async (_args, ctx) => {
      const activeSessions = getActiveSessions();
      
      if (activeSessions.length === 0) {
        ctx.ui.notify('No active sub-agents', 'info');
        return;
      }

      const listText = activeSessions.map(s => {
        const statusIcon = { running: '🟢', waiting_manager: '🟡', waiting_user: '🟡', complete: '✅', error: '❌', killed: '💀' };
        return `${statusIcon[s.status as keyof typeof statusIcon] || '⚪'} ${s.subagentId} (${s.sessionId}) - ${s.status}`;
      }).join('\n');

      ctx.ui.notify(`Active agents:\n${listText}`, 'info');
    },
  });

  // ── /kill command ──────────────────────────────────────
  api.registerCommand('kill', {
    description: 'Kill a running sub-agent by session ID',
    handler: async (args, ctx) => {
      const sessionId = args?.trim();
      
      if (!sessionId) {
        const active = getActiveSessions();
        if (active.length === 0) {
          ctx.ui.notify('No active sub-agents to kill', 'info');
          return;
        }
        ctx.ui.notify('Usage: /kill <session-id>', 'info');
        return;
      }

      const killed = spawn.killSubagent(sessionId);
      if (killed) {
        ctx.ui.notify(`Killed sub-agent: ${sessionId}`, 'success');
      } else {
        ctx.ui.notify(`Could not kill ${sessionId} - not found or already stopped`, 'warning');
      }
    },
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getAvailableAgents(): string[] {
  const agents: string[] = [];
  const searchPaths = [
    join(process.env.HOME || '', '.pi', 'agents'),
    join(process.env.HOME || '', '.pi', 'agent-team', 'agents'),
    join(currentCwd, '.pi', 'agents'),
    join(currentCwd, '.pi', 'agent-team', 'agents'),
  ];

  for (const agentPath of searchPaths) {
    if (!existsSync(agentPath)) continue;
    try {
      const files = readdirSync(agentPath);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const name = f.replace(/\.md$/, '');
          if (!agents.includes(name)) {
            agents.push(name);
          }
        }
      }
    } catch {}
  }

  return agents;
}

function getActiveSessions() {
  const sessions: session.SessionState[] = [];
  const sessionDir = session.getSessionDir();

  if (!existsSync(sessionDir)) return sessions;

  try {
    const files = readdirSync(sessionDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.replace('.json', '');
      const state = session.readSession(sid);
      if (state && state.status !== 'complete' && state.status !== 'killed') {
        sessions.push(state);
      }
    }
  } catch {}

  return sessions;
}

async function showAgentSelect(api: ExtensionAPI, ctx: any, agents: string[]): Promise<string | null> {
  const items = agents.map(a => ({ label: a, value: a }));

  return new Promise((resolve) => {
    ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg('accent', 'Select Agent:'), 1, 1));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t) => theme.fg('accent', t),
        selectedText: (t) => theme.fg('accent', t),
      });
      selectList.onSelect = (item) => done(item?.value ?? null);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new Text(theme.fg('dim', '↑↓ navigate • enter select • esc cancel'), 1, 0));

      return {
        render: (width: number) => container.render(width),
        handleInput: (data: string) => {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    }).then(resolve).catch(() => resolve(null));
  });
}

async function showTeamSelect(api: ExtensionAPI, ctx: any, teams: { label: string; value: string }[]): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg('accent', 'Select Team:'), 1, 1));

      const selectList = new SelectList(teams, Math.min(teams.length, 10), {
        selectedPrefix: (t) => theme.fg('accent', t),
        selectedText: (t) => theme.fg('accent', t),
      });
      selectList.onSelect = (item) => done(item?.value ?? null);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new Text(theme.fg('dim', '↑↓ navigate • enter select • esc cancel'), 1, 0));

      return {
        render: (width: number) => container.render(width),
        handleInput: (data: string) => {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    }).then(resolve).catch(() => resolve(null));
  });
}

// ============================================
// TEAM MODE STATE
// ============================================

export function isTeamModeActive(): boolean {
  return teamModeActive;
}

export function getCurrentTeamName(): string {
  return currentTeamName;
}

export function getTeamConfig(cwd: string): TeamConfig | null {
  const teams = loadTeamsYaml(cwd);
  return teams ? teams[currentTeamName] ?? null : null;
}