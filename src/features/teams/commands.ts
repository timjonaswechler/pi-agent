// ============================================
// SLASH COMMANDS: /agent, /team, /list, /kill
// ============================================

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync } from "fs";
import * as session from "../session/index.ts";
import * as spawn from "../sub-agent/index.ts";
import { getAgentInfo } from "../sub-agent/index.ts";
import { getMemberDirSearchPaths } from "../../shared/paths.ts";
import { loadTeamsYaml, type TeamConfig } from "./config.ts";
import { startQuestionPoller, stopQuestionPoller, isPollerStarted, resetQuestionRoutingStateForTests } from "./question-poller.ts";
import { showAgentSelect, showTeamSelect } from "./ui.ts";

// ============================================
// MODULE-LEVEL STATE
// ============================================

let currentCwd = "";
let teamModeActive = false;
let currentTeamName = "";
let pendingDelegationAgent: string | null = null;

// ============================================
// REGISTER COMMANDS
// ============================================

export function registerCommands(api: ExtensionAPI): void {
  api.on("session_start", async (_event, ctx: ExtensionContext) => {
    currentCwd = ctx.cwd;

    if (!isPollerStarted() && ctx.hasUI) {
      startQuestionPoller(api, ctx);
    }
  });

  api.on("input", async (event, ctx: ExtensionContext) => {
    if (!pendingDelegationAgent) return { action: "continue" };
    if (event.source === "extension") return { action: "continue" };

    const taskDesc = event.text?.trim();
    const agentName = pendingDelegationAgent;
    pendingDelegationAgent = null;

    if (!taskDesc) {
      ctx.ui.notify(`Delegation for ${agentName} cancelled: empty task`, "warning");
      return { action: "handled" };
    }

    startAgentTask(ctx, agentName, taskDesc, 'solo');
    return { action: "handled" };
  });

  // ── /agent command ──────────────────────────────────────
  api.registerCommand("agent", {
    description:
      "Spawn a sub-agent to execute a task without polluting your session context",
    getArgumentCompletions: (prefix: string) => {
      const agents = getAvailableAgents();
      return agents
        .filter((a) => a.startsWith(prefix))
        .map((a) => ({ value: a, label: a }));
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmedArgs = args?.trim() || "";
      const agentName = trimmedArgs.split(/\s+/)[0] || "";
      const taskDesc = trimmedArgs.substring(agentName.length).trim() || "";

      if (agentName === "cancel") {
        if (pendingDelegationAgent) {
          const cancelledAgent = pendingDelegationAgent;
          pendingDelegationAgent = null;
          ctx.ui.notify(`Cancelled pending delegation for ${cancelledAgent}`, "info");
        } else {
          ctx.ui.notify(
            "No pending delegation to cancel. To stop a running subagent, use /list and then /kill <session-id>.",
            "info",
          );
        }
        return;
      }

      if (!trimmedArgs) {
        const agents = getAvailableAgents();
        if (agents.length === 0) {
          ctx.ui.notify("No team members found in ~/.pi/teams/members/", "warning");
          return;
        }

        const selected = await showAgentSelect(api, ctx, agents);
        if (!selected) return;

        pendingDelegationAgent = selected;
        ctx.ui.notify(
          `Delegation armed for ${selected}. Enter the task in your next message or run /agent cancel.`,
          "info",
        );
        return;
      }

      if (!taskDesc) {
        pendingDelegationAgent = agentName;
        ctx.ui.notify(
          `Delegation armed for ${agentName}. Enter the task in your next message or run /agent cancel.`,
          "info",
        );
        return;
      }

      startAgentTask(ctx, agentName, taskDesc, 'solo');
    },
  });

  // ── /team command ──────────────────────────────────────
  api.registerCommand("team", {
    description: "Activate Team Mode for orchestrating multiple agents",
    handler: async (args, ctx: ExtensionCommandContext) => {
      let teams: ReturnType<typeof loadTeamsYaml>;
      try {
        teams = loadTeamsYaml(ctx.cwd);
      } catch (error) {
        ctx.ui.notify(
          `Failed to load teams.yaml: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      if (!teams) {
        ctx.ui.notify("No teams.yaml found", "warning");
        return;
      }

      if (teamModeActive) {
        teamModeActive = false;
        currentTeamName = "";
        ctx.ui.notify("Team Mode deactivated", "info");
        ctx.ui.setStatus("team", undefined);
        return;
      }

      const teamEntries = Object.entries(teams).map(([name, config]) => ({
        label: `${name} (${config.members.length} members)`,
        value: name,
      }));

      const selected = await showTeamSelect(api, ctx, teamEntries);
      if (!selected) return;

      teamModeActive = true;
      currentTeamName = selected;
      ctx.ui.setStatus("team", `Team: ${selected}`);

      const team = teams[selected];

      const memberDetails = team.members
        .map((member) => {
          const info = getAgentInfo(member, ctx.cwd);
          return info?.description ? `- ${member}: ${info.description}` : `- ${member}`;
        })
        .join("\n");

      const memberNames = team.members.join(", ");

      let finalPrompt = "";
      if (team.manager) {
        const leaderInfo = getAgentInfo(team.manager, ctx.cwd);
        if (leaderInfo?.systemPrompt) {
          finalPrompt = leaderInfo.systemPrompt
            .replace(/{TEAM_NAME}/g, selected)
            .replace(/{MEMBERS_LIST}/g, memberDetails)
            .replace(/{MEMBER_NAMES}/g, memberNames);
        }
      }

      const systemMessage =
        finalPrompt ||
        `[TEAM MODE] You are the Team Manager for "${selected}".\n\n` +
          `Team members:\n${memberDetails}\n\n` +
          `Use run_subagents to delegate tasks.`;

      api.sendMessage(
        {
          customType: "team-mode-context",
          content: systemMessage,
          display: false,
          details: {
            teamName: selected,
            manager: team.manager,
            members: team.members,
          },
        },
        { deliverAs: "nextTurn" },
      );

      ctx.ui.notify(`Team Mode activated: ${selected}`, "success");
    },
  });

  // ── /list command ──────────────────────────────────────
  api.registerCommand("list", {
    description: "List active sub-agents with their status",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const activeSessions = getActiveSessions();

      if (activeSessions.length === 0) {
        ctx.ui.notify("No active sub-agents", "info");
        return;
      }

      const listText = activeSessions
        .map((s) => {
          const statusIcon = {
            idle: "⚪",
            running: "🟢",
            waiting_manager: "🟡",
            waiting_user: "🟡",
            complete: "✅",
            error: "❌",
            killed: "💀",
            timeout: "⌛",
            orphaned: "👻",
          };
          return `${statusIcon[s.status as keyof typeof statusIcon] || "⚪"} ${s.subagentId} (${s.sessionId}) - ${s.status}`;
        })
        .join("\n");

      ctx.ui.notify(`Active agents:\n${listText}`, "info");
    },
  });

  // ── /kill command ──────────────────────────────────────
  api.registerCommand("kill", {
    description: "Kill a running sub-agent by session ID",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const sessionId = args?.trim();

      if (!sessionId) {
        const active = getActiveSessions();
        if (active.length === 0) {
          ctx.ui.notify("No active sub-agents to kill", "info");
          return;
        }
        ctx.ui.notify("Usage: /kill <session-id>", "info");
        return;
      }

      const killed = spawn.killSubagent(sessionId);
      if (killed) {
        ctx.ui.notify(`Killed sub-agent: ${sessionId}`, "success");
      } else {
        ctx.ui.notify(
          `Could not kill ${sessionId} - not found or already stopped`,
          "warning",
        );
      }
    },
  });
}

// ============================================
// PRIVATE HELPERS
// ============================================

function startAgentTask(
  ctx: ExtensionContext,
  agentName: string,
  taskDesc: string,
  spawnType: 'solo' | 'team' = 'solo',
): void {
  ctx.ui.notify(`Starting agent '${agentName}'...`, "info");
  ctx.ui.setStatus("agent", `Running ${agentName}...`);

  const { sessionId, promise } = spawn.spawnAndAwait(
    taskDesc,
    { cwd: ctx.cwd, agent: agentName, mode: 'manager', spawnType },
    (msg) => ctx.ui.notify(msg, 'info'),
  );
  ctx.ui.notify(`Agent started: ${sessionId}`, "success");

  promise
    .then((result) => {
      ctx.ui.setStatus("agent", undefined);
      if (result.success) {
        ctx.ui.notify(`Agent ${agentName} done ✅`, 'success');
      } else {
        ctx.ui.notify(`Agent ${agentName} failed: ${result.error}`, 'error');
      }
    })
    .catch(() => {
      ctx.ui.setStatus("agent", undefined);
    });
}

function getAvailableAgents(): string[] {
  const agents: string[] = [];
  const searchPaths = getMemberDirSearchPaths(currentCwd);

  for (const agentPath of searchPaths) {
    if (!existsSync(agentPath)) continue;
    try {
      const files = readdirSync(agentPath);
      for (const f of files) {
        if (f.endsWith(".md")) {
          const name = f.replace(/\.md$/, "");
          if (!agents.includes(name)) agents.push(name);
        }
      }
    } catch {}
  }

  return agents;
}

function getActiveSessions(): session.SessionState[] {
  const root = session.getOrchestrationRootId();
  return session
    .listSessionsByRoot(root)
    .filter(
      (s) =>
        s.status !== 'complete' &&
        s.status !== 'killed' &&
        s.status !== 'timeout' &&
        s.status !== 'error' &&
        s.status !== 'orphaned',
    );
}

// ============================================
// STATE ACCESSORS
// ============================================

export function isTeamModeActive(): boolean {
  return teamModeActive;
}

export function getCurrentTeamName(): string {
  return currentTeamName;
}

export function getTeamConfig(cwd: string): TeamConfig | null {
  const teams = loadTeamsYaml(cwd);
  return teams ? (teams[currentTeamName] ?? null) : null;
}

export function resetTeamsStateForTests(): void {
  currentCwd = "";
  teamModeActive = false;
  currentTeamName = "";
  pendingDelegationAgent = null;
  stopQuestionPoller();
  resetQuestionRoutingStateForTests();
}
