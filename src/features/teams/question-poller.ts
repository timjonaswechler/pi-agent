// ============================================
// QUESTION POLLER
// ============================================
//
// Polls session files every 500ms for pending subagent questions.
//
// solo  → shows a UI input prompt and auto-answers the subagent
// team  → injects a steer message so the active manager can respond
// ============================================

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as session from "../session/index.ts";

const POLL_INTERVAL_MS = 500;

let pollerStarted = false;
let pollerInterval: ReturnType<typeof setInterval> | null = null;
const handlingSoloQuestions = new Set<string>();
const announcedTeamQuestions = new Set<string>();

export function isPollerStarted(): boolean {
  return pollerStarted;
}

export function startQuestionPoller(api: ExtensionAPI, ctx: ExtensionContext): void {
  pollerStarted = true;
  pollerInterval = setInterval(() => {
    void processPendingQuestions(api, ctx);
  }, POLL_INTERVAL_MS);
}

export function stopQuestionPoller(): void {
  if (pollerInterval !== null) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    pollerStarted = false;
  }
}

export async function processPendingQuestions(
  api: Pick<ExtensionAPI, 'sendMessage'>,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx?.hasUI) return;

  const pending = session.getAllPendingManagerQuestions(
    session.getOrchestrationRootId(),
  );
  const pendingKeys = new Set(pending.map((item) => `${item.sessionId}:${item.question.id}`));

  // Clean up stale announced keys
  for (const key of Array.from(announcedTeamQuestions)) {
    if (!pendingKeys.has(key)) {
      announcedTeamQuestions.delete(key);
    }
  }

  // Handle the first unhandled solo question via UI input
  const soloQuestion = pending.find(
    (item) =>
      item.spawnType === 'solo' &&
      !handlingSoloQuestions.has(`${item.sessionId}:${item.question.id}`),
  );

  if (soloQuestion) {
    const key = `${soloQuestion.sessionId}:${soloQuestion.question.id}`;
    handlingSoloQuestions.add(key);

    try {
      const prompt = [
        `Subagent ${soloQuestion.agentProfile ?? soloQuestion.subagentId} needs clarification.`,
        soloQuestion.question.question,
        soloQuestion.question.context ? `Context: ${soloQuestion.question.context}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');

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

  // Surface team questions to the active manager (once per question)
  for (const teamQuestion of pending.filter((item) => item.spawnType === 'team')) {
    const key = `${teamQuestion.sessionId}:${teamQuestion.question.id}`;
    if (announcedTeamQuestions.has(key)) continue;

    announcedTeamQuestions.add(key);

    api.sendMessage(
      {
        customType: 'team-subagent-question',
        content: buildTeamQuestionPrompt(teamQuestion),
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

export function resetQuestionRoutingStateForTests(): void {
  handlingSoloQuestions.clear();
  announcedTeamQuestions.clear();
}
