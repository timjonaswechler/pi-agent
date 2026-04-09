// ============================================
// TOOLS
// ============================================
//
// run_subagents        — spawn N subagents in parallel, await all results
// ask_manager_question — subagent writes question to session file and BLOCKS
//                        until the manager answers (via answer_manager_question)
// answer_manager_question — manager writes answer to unblock the subagent
// get_pending_questions   — list all unanswered manager questions across sessions
// ============================================

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as session from '../../features/session/index.ts';
import * as spawn from '../../features/sub-agent/index.ts';

// ============================================
// run_subagents
// ============================================

export function registerRunSubagentsTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'run_subagents',
    label: 'Run Sub-Agents',
    description: [
      'Spawn one or more sub-agents to work on tasks in parallel.',
      'Each sub-agent runs as a separate pi process and returns its final output.',
      'All agents run concurrently — results are returned when ALL have finished.',
      '',
      'If a sub-agent needs manager clarification (ask_manager_question), it will pause.',
      'You can answer pending questions with answer_manager_question while waiting,',
      'but note: run_subagents blocks until completion, so the manager-question',
      'pattern works best with spawn_background + collect_results for longer tasks.',
      '',
      'Use `agent` to specify a named agent profile from ~/.pi/agents/ or .pi/agents/.',
    ].join('\n'),
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          description: Type.String({
            description: 'The task description to give the sub-agent',
          }),
          agent: Type.Optional(
            Type.String({
              description:
                'Agent profile name (e.g. "researcher", "git-expert"). Loads system prompt from .pi/agents/<name>.md',
            }),
          ),
        }),
        {
          description: 'Tasks to run in parallel. All start immediately.',
          minItems: 1,
        },
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description: 'Max seconds to wait for each sub-agent (default: 300)',
          minimum: 10,
          maximum: 1800,
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const timeoutMs = (params.timeoutSeconds ?? 300) * 1000;
      const tasks = params.tasks;

      onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Spawning ${tasks.length} sub-agent(s)...`,
          },
        ],
      });

      // Spawn all subagents and collect their promises
      const spawnedTasks = tasks.map((task) =>
        spawn.spawnAndAwait(
          task.description,
          {
            cwd: ctx.cwd,
            agent: task.agent,
            mode: 'manager',
            timeoutMs,
          },
          (msg) => {
            onUpdate?.({ content: [{ type: 'text', text: msg }] });
          },
        ),
      );

      // Await all results
      const results = await Promise.all(spawnedTasks.map((t) => t.promise));

      // Format response
      const lines: string[] = [];
      let allSuccess = true;

      results.forEach((result, i) => {
        const icon = result.success ? '✅' : '❌';
        const agentLabel = result.agent !== 'default' ? ` (${result.agent})` : '';
        lines.push(`### Task ${i + 1}${agentLabel} — ${icon}`);
        lines.push(`Session: \`${result.sessionId}\``);
        lines.push(`Duration: ${(result.elapsedMs / 1000).toFixed(1)}s`);
        lines.push('');

        if (result.success) {
          lines.push(result.output);
        } else {
          allSuccess = false;
          lines.push(`**Error:** ${result.error ?? 'Unknown error'}`);
        }

        // Surface any unanswered manager questions
        if (result.pendingQuestions.length > 0) {
          lines.push('');
          lines.push('**⚠️ Unanswered questions from this sub-agent:**');
          for (const q of result.pendingQuestions) {
            lines.push(`- [${q.questionId}] ${q.question}`);
          }
          lines.push(
            '_These sub-agent(s) timed out waiting for your answer.',
            'Re-run with more context or answer via answer_manager_question._',
          );
        }

        lines.push('');
        lines.push('---');
        lines.push('');
      });

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { results, allSuccess },
      };
    },
  });
}

// ============================================
// ask_manager_question
// ============================================
//
// This tool is called BY A SUBAGENT (in its own pi process).
// It:
//   1. Reads its own session ID from PI_AGENT_SESSION_ID env var
//   2. Writes the question to the shared session file
//   3. Blocks (polls every 500ms) until the manager writes an answer
//   4. Returns the answer to the subagent LLM
//
// The manager answers via answer_manager_question.
// ============================================

export function registerAskManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'ask_manager_question',
    label: 'Ask Manager',
    description: [
      'Ask your manager (the parent agent) for clarification or additional information.',
      'This call BLOCKS until the manager responds — do not proceed until you have the answer.',
      'Only use this when you genuinely cannot continue without input from the manager.',
    ].join('\n'),
    parameters: Type.Object({
      question: Type.String({
        description: 'Your question for the manager',
      }),
      context: Type.Optional(
        Type.String({
          description: 'Additional context to help the manager answer',
        }),
      ),
    }),

    async execute(toolCallId, params, signal, _onUpdate, _ctx) {
      // Get this subagent's session ID from env (set by the parent when spawning)
      const sessionId = process.env.PI_AGENT_SESSION_ID;
      if (!sessionId) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: No session ID found (PI_AGENT_SESSION_ID not set). Cannot ask manager.',
            },
          ],
          isError: true,
        };
      }

      // Ensure session exists
      let state = session.readSession(sessionId);
      if (!state) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Session ${sessionId} not found.`,
            },
          ],
          isError: true,
        };
      }

      // Write question to session file
      const pending = session.addQuestion(sessionId, {
        type: 'manager',
        question: params.question,
        context: params.context,
      });

      // Block until answered (or signal aborts / timeout)
      const answer = await session.waitForAnswer(sessionId, pending.id, signal);

      if (answer === null) {
        return {
          content: [
            {
              type: 'text',
              text: `Manager did not respond to question "${params.question}" in time. Proceeding with best judgment.`,
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: `Manager answered: ${answer}` }],
        details: { questionId: pending.id, question: params.question, answer },
      };
    },
  });
}

// ============================================
// answer_manager_question
// ============================================
//
// Called by the MANAGER to answer a pending subagent question.
// Writing the answer to the session file unblocks the subagent's
// ask_manager_question poll loop.
// ============================================

export function registerAnswerManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'answer_manager_question',
    label: 'Answer Sub-Agent Question',
    description: [
      'Answer a pending question from a sub-agent.',
      'Use get_pending_questions first to see what sub-agents are waiting for.',
      'Providing an answer unblocks the sub-agent so it can continue working.',
    ].join('\n'),
    parameters: Type.Object({
      sessionId: Type.String({
        description: 'Session ID of the sub-agent asking the question',
      }),
      questionId: Type.String({
        description: 'ID of the question (from get_pending_questions)',
      }),
      answer: Type.String({
        description: 'Your answer to the sub-agent',
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { sessionId, questionId, answer } = params;

      const state = session.readSession(sessionId);
      if (!state) {
        return {
          content: [{ type: 'text', text: `Session ${sessionId} not found.` }],
          isError: true,
        };
      }

      const question = state.pendingQuestions.find((q) => q.id === questionId);
      if (!question) {
        return {
          content: [
            {
              type: 'text',
              text: `Question ${questionId} not found in session ${sessionId}.`,
            },
          ],
          isError: true,
        };
      }

      if (question.answer) {
        return {
          content: [
            {
              type: 'text',
              text: `Question ${questionId} already has an answer: "${question.answer}"`,
            },
          ],
        };
      }

      // Write the answer — this unblocks the subagent's poll loop
      session.answerQuestion(sessionId, questionId, answer);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Answered question for sub-agent ${sessionId}.\nQuestion: "${question.question}"\nAnswer: "${answer}"\n\nThe sub-agent will now continue.`,
          },
        ],
        details: { sessionId, questionId, question: question.question, answer },
      };
    },
  });
}

// ============================================
// get_pending_questions
// ============================================

export function registerGetPendingQuestionsTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'get_pending_questions',
    label: 'Get Pending Questions',
    description:
      'List all unanswered questions from sub-agents waiting for manager input. Use answer_manager_question to respond.',
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const pending = session.getAllPendingManagerQuestions();

      if (pending.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pending questions from sub-agents.' }],
        };
      }

      const lines = pending.map(
        (p) =>
          `- Session \`${p.sessionId}\` (${p.subagentId})\n  Question ID: \`${p.question.id}\`\n  Question: ${p.question.question}${p.question.context ? `\n  Context: ${p.question.context}` : ''}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: `**${pending.length} pending question(s):**\n\n${lines.join('\n\n')}`,
          },
        ],
        details: { pending },
      };
    },
  });
}

// ============================================
// REGISTER ALL TOOLS
// ============================================

export function registerAllTools(api: ExtensionAPI): void {
  registerRunSubagentsTool(api);
  registerAskManagerQuestionTool(api);
  registerAnswerManagerQuestionTool(api);
  registerGetPendingQuestionsTool(api);
}
