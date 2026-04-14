// ============================================
// SLASH COMMANDS: /agent, /team, /list, /kill
// ============================================

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text, SelectList, Container } from "@mariozechner/pi-tui";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import * as session from "../session/index.ts";
import * as spawn from "../sub-agent/index.ts";
import { getAgentInfo } from "../sub-agent/index.ts";
import { getTeamsYamlSearchPaths, getMemberDirSearchPaths } from "./paths.ts";

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
  const searchPaths = getTeamsYamlSearchPaths(cwd);

  // Collect all teams, higher priority wins
  const teams: TeamsYaml = {};
  const teamPriorities: Record<string, number> = {};
  let foundAny = false;

  for (const { path, priority } of searchPaths) {
    if (existsSync(path)) {
      foundAny = true;
      const content = readFileSync(path, "utf-8");
      const parsed = parseTeamsYaml(content);

      // Merge: only overwrite if this source has strictly higher priority
      for (const [name, config] of Object.entries(parsed)) {
        if (!teams[name] || priority > (teamPriorities[name] ?? 0)) {
          teams[name] = config;
          teamPriorities[name] = priority;
        }
      }
    }
  }

  return foundAny && Object.keys(teams).length > 0 ? teams : null;
}

function parseTeamsYaml(yamlContent: string): TeamsYaml {
  const parsed = yaml.load(yamlContent);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const teams: TeamsYaml = {};

  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid team config for '${name}': expected a mapping`);
    }

    const config = value as Record<string, unknown>;
    const manager = typeof config.manager === "string" ? config.manager.trim() : "";
    const members = Array.isArray(config.members)
      ? config.members.filter((member): member is string => typeof member === "string").map((member) => member.trim()).filter(Boolean)
      : [];
    const description = typeof config.description === "string"
      ? config.description.trim()
      : undefined;

    if (!manager) {
      throw new Error(`Invalid team config for '${name}': missing manager`);
    }

    teams[name] = { manager, members, description };
  }

  return teams;
}

// ============================================
// REGISTER COMMANDS
// ============================================

let currentCwd = "";
let teamModeActive = false;
let currentTeamName = "";
let pendingDelegationAgent: string | null = null;
let questionPollerStarted = false;
let questionPollerInterval: ReturnType<typeof setInterval> | null = null;
const handlingSoloQuestions = new Set<string>();
const announcedTeamQuestions = new Set<string>();

export function registerCommands(api: ExtensionAPI): void {
  // Store cwd for agent lookups
  api.on("session_start", async (_event, ctx) => {
    currentCwd = ctx.cwd;

    if (!questionPollerStarted && ctx.hasUI) {
      questionPollerStarted = true;
      startQuestionPoller(api, ctx);
    }
  });

  api.on("input", async (event, ctx) => {
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
    handler: async (args, ctx) => {
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

      // Show agent selection if no args
      if (!trimmedArgs) {
        const agents = getAvailableAgents();
        if (agents.length === 0) {
          ctx.ui.notify("No team members found in ~/.pi/teams/members/", "warning");
          return;
        }

        const selected = await showAgentSelect(api, ctx, agents);
        if (!selected) return;

        pendingDelegationAgent = selected;
        ctx.ui.notify(`Delegation armed for ${selected}. Enter the task in your next message or run /agent cancel.`, "info");
        return;
      }

      // If only agent name, arm next message as the task
      if (!taskDesc) {
        pendingDelegationAgent = agentName;
        ctx.ui.notify(`Delegation armed for ${agentName}. Enter the task in your next message or run /agent cancel.`, "info");
        return;
      }

      startAgentTask(ctx, agentName, taskDesc, 'solo');
    },
  });

  // ── /team command ──────────────────────────────────────
  api.registerCommand("team", {
    description: "Activate Team Mode for orchestrating multiple agents",
    handler: async (args, ctx) => {
      let teams: TeamsYaml | null;
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

      // Toggle off if active
      if (teamModeActive) {
        teamModeActive = false;
        currentTeamName = "";
        ctx.ui.notify("Team Mode deactivated", "info");
        ctx.ui.setStatus("team", undefined);
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
      ctx.ui.setStatus("team", `Team: ${selected}`);

      // Inject team context as system message
      const team = teams[selected];

      // Build member details list with descriptions
      const memberDetails = team.members
        .map((member) => {
          const info = getAgentInfo(member, ctx.cwd);
          if (info?.description) {
            return `- ${member}: ${info.description}`;
          }
          return `- ${member}`;
        })
        .join("\n");

      // Build comma-separated member names
      const memberNames = team.members.join(", ");

      // Get team leader's system prompt and replace placeholders
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
    handler: async (_args, ctx) => {
      const activeSessions = getActiveSessions();

      if (activeSessions.length === 0) {
        ctx.ui.notify("No active sub-agents", "info");
        return;
      }

      const listText = activeSessions
        .map((s) => {
          const statusIcon = {
            running: "🟢",
            waiting_manager: "🟡",
            waiting_user: "🟡",
            complete: "✅",
            error: "❌",
            killed: "💀",
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
    handler: async (args, ctx) => {
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
// HELPER FUNCTIONS
// ============================================

function startQuestionPoller(api: ExtensionAPI, ctx: any): void {
  const pollIntervalMs = 500;
  questionPollerInterval = setInterval(() => {
    void processPendingQuestions(api, ctx);
  }, pollIntervalMs);
}

export function stopQuestionPoller(): void {
  if (questionPollerInterval !== null) {
    clearInterval(questionPollerInterval);
    questionPollerInterval = null;
    questionPollerStarted = false;
  }
}

export async function processPendingQuestions(api: Pick<ExtensionAPI, 'sendMessage'>, ctx: any): Promise<void> {
  if (!ctx?.hasUI) return;

  const pending = session.getAllPendingManagerQuestions();
  const pendingKeys = new Set(pending.map((item) => `${item.sessionId}:${item.question.id}`));

  for (const key of Array.from(announcedTeamQuestions)) {
    if (!pendingKeys.has(key)) {
      announcedTeamQuestions.delete(key);
    }
  }

  const soloQuestion = pending.find(
    (item) => item.spawnType === 'solo' && !handlingSoloQuestions.has(`${item.sessionId}:${item.question.id}`),
  );

  if (soloQuestion) {
    const key = `${soloQuestion.sessionId}:${soloQuestion.question.id}`;
    handlingSoloQuestions.add(key);

    try {
      const prompt = [
        `Subagent ${soloQuestion.agentProfile ?? soloQuestion.subagentId} needs clarification.`,
        soloQuestion.question.question,
        soloQuestion.question.context ? `Context: ${soloQuestion.question.context}` : undefined,
      ].filter(Boolean).join('\n\n');

      const answer = await ctx.ui.input(prompt, 'Type your answer for the subagent...');

      session.answerQuestion(
        soloQuestion.sessionId,
        soloQuestion.question.id,
        answer?.trim() || 'User cancelled or provided no answer. Proceed with best judgment.',
      );

      ctx.ui.notify(
        `Answered question for ${soloQuestion.agentProfile ?? soloQuestion.subagentId}`,
        'success',
      );
    } catch (error) {
      session.answerQuestion(
        soloQuestion.sessionId,
        soloQuestion.question.id,
        'User interaction failed. Proceed with best judgment.',
      );
      ctx.ui.notify(
        `Failed to collect answer for ${soloQuestion.agentProfile ?? soloQuestion.subagentId}: ${error instanceof Error ? error.message : String(error)}`,
        'warning',
      );
    } finally {
      handlingSoloQuestions.delete(key);
    }
  }

  for (const teamQuestion of pending.filter((item) => item.spawnType === 'team')) {
    const key = `${teamQuestion.sessionId}:${teamQuestion.question.id}`;
    if (announcedTeamQuestions.has(key)) continue;

    announcedTeamQuestions.add(key);

    const message = buildTeamQuestionPrompt(teamQuestion);

    api.sendMessage(
      {
        customType: 'team-subagent-question',
        content: message,
        display: true,
        details: {
          sessionId: teamQuestion.sessionId,
          questionId: teamQuestion.question.id,
          subagentId: teamQuestion.subagentId,
          agentProfile: teamQuestion.agentProfile,
          spawnType: teamQuestion.spawnType,
          teamName: teamQuestion.teamName,
          context: teamQuestion.question.context,
        },
      },
      { deliverAs: 'steer', triggerTurn: true },
    );

    ctx.ui.notify(
      `Manager decision needed for ${teamQuestion.agentProfile ?? teamQuestion.subagentId}`,
      'info',
    );
  }
}

export function buildTeamQuestionPrompt(teamQuestion: {
  sessionId: string;
  subagentId: string;
  spawnType?: 'solo' | 'team';
  teamName?: string;
  agentProfile?: string;
  question: { id: string; question: string; context?: string };
}): string {
  const agentLabel = teamQuestion.agentProfile ?? teamQuestion.subagentId;
  const lines = [
    `[TEAM SUBAGENT QUESTION] ${agentLabel} is blocked and needs clarification.`,
    teamQuestion.teamName ? `Team: ${teamQuestion.teamName}` : undefined,
    `Session ID: ${teamQuestion.sessionId}`,
    `Question ID: ${teamQuestion.question.id}`,
    `Question: ${teamQuestion.question.question}`,
    teamQuestion.question.context ? `Context: ${teamQuestion.question.context}` : undefined,
    '',
    'Decide at the manager level:',
    '- Answer directly yourself if this is an operational or delegated decision.',
    '- Escalate to the user only if this changes requirements, scope, approval, or business intent.',
    '',
    'Then answer the subagent with answer_manager_question using the exact session/question IDs above.',
    'If you need user input first, use ask_user_question, then forward the resolved answer to the subagent.',
  ];

  return lines.filter(Boolean).join('\n');
}

function startAgentTask(
  ctx: any,
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
  ctx.ui.setStatus("agent", `Running ${agentName}...`);

  promise.then((result) => {
    ctx.ui.setStatus("agent", undefined);
    if (result.success) {
      ctx.ui.notify(`Agent ${agentName} done ✅`, 'success');
    } else {
      ctx.ui.notify(`Agent ${agentName} failed: ${result.error}`, 'error');
    }
  }).catch(() => {
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
      if (!file.endsWith(".json")) continue;
      const sid = file.replace(".json", "");
      const state = session.readSession(sid);
      if (state && state.status !== "complete" && state.status !== "killed") {
        sessions.push(state);
      }
    }
  } catch (err) {
    console.error('[pi-agent] Failed to read session directory:', err);
  }

  return sessions;
}

async function showAgentSelect(
  api: ExtensionAPI,
  ctx: any,
  agents: string[],
): Promise<string | null> {
  const items = agents.map((a) => ({ label: a, value: a }));

  return new Promise((resolve) => {
    ctx.ui
      .custom<string | null>((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", "Select Agent:"), 1, 1));

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
        });
        selectList.onSelect = (item) => done(item?.value ?? null);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
            1,
            0,
          ),
        );

        return {
          render: (width: number) => container.render(width),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      })
      .then(resolve)
      .catch(() => resolve(null));
  });
}

async function showTeamSelect(
  api: ExtensionAPI,
  ctx: any,
  teams: { label: string; value: string }[],
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui
      .custom<string | null>((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", "Select Team:"), 1, 1));

        const selectList = new SelectList(teams, Math.min(teams.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
        });
        selectList.onSelect = (item) => done(item?.value ?? null);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
            1,
            0,
          ),
        );

        return {
          render: (width: number) => container.render(width),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      })
      .then(resolve)
      .catch(() => resolve(null));
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
  return teams ? (teams[currentTeamName] ?? null) : null;
}

export function resetQuestionRoutingStateForTests(): void {
  handlingSoloQuestions.clear();
  announcedTeamQuestions.clear();
}

export function resetTeamsStateForTests(): void {
  currentCwd = "";
  teamModeActive = false;
  currentTeamName = "";
  pendingDelegationAgent = null;
  stopQuestionPoller();
  resetQuestionRoutingStateForTests();
}
