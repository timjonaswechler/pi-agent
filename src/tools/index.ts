// ============================================
// TOOLS: run_subagents, ask_manager_question, answer_manager_question, forward_to_user
// ============================================

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as session from '../session';
import * as spawn from '../spawn';
import * as managerBridge from '../bridge/manager';

// ============================================
// TOOL: run_subagents
// ============================================

interface SubagentTask {
  description: string;
  agent?: string;
  mode?: 'user' | 'manager';
}

export function registerRunSubagentsTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'run_subagents',
    label: 'Run Sub-Agents',
    description: 'Run multiple tasks in parallel using specialized sub-agents.',
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          description: Type.String({ description: 'Task description for the sub-agent' }),
          agent: Type.Optional(Type.String({ description: 'Agent profile name (e.g., researcher, git_expert)' })),
          mode: Type.Optional(Type.Union([
            Type.Literal('user'),
            Type.Literal('manager'),
          ], { description: 'user=direct to user, manager=via manager' })),
        }),
        { description: 'List of tasks to execute in parallel' }
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tasks: SubagentTask[] = params.tasks;

      onUpdate?.({
        content: [{ type: 'text', text: `Starting ${tasks.length} sub-agent(s)...` }],
      });

      try {
        // Run all tasks in parallel
        const results = await Promise.all(
          tasks.map(async (task, index) => {
            const result = spawn.spawnSubagent(task.description, {
              cwd: ctx.cwd,
              agent: task.agent,
              mode: task.mode || 'user',
            });

            // Track in manager mode if applicable
            if (task.mode === 'manager') {
              managerBridge.setManagerMode(result.session.sessionId, true);
            }

            return {
              sessionId: result.session.sessionId,
              agent: task.agent || 'default',
              output: `Sub-agent started: ${result.session.sessionId}`,
            };
          })
        );

        // Format output
        let response = `Started ${results.length} sub-agent(s) in parallel:\n\n`;
        results.forEach((res, i) => {
          response += `### Task ${i + 1} (${res.agent})\nSession: ${res.sessionId}\n\n`;
        });

        return {
          content: [{ type: 'text', text: response }],
          details: { results },
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Failed to execute sub-agents: ${error.message}` }],
          isError: true,
        };
      }
    },
  });
}

// ============================================
// TOOL: ask_manager_question
// ============================================

export function registerAskManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'ask_manager_question',
    label: 'Ask Manager',
    description: 'Ask the manager (parent agent) for help or clarification',
    parameters: Type.Object({
      sessionId: Type.String({ description: 'Session ID of the sub-agent' }),
      question: Type.String({ description: 'Question to ask the manager' }),
      context: Type.Optional(Type.String({ description: 'Additional context for the question' })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { sessionId, question, context } = params;

      // Add question to session
      const pendingQuestion = session.addQuestion(sessionId, {
        type: 'manager',
        question,
        context,
      });

      // Track in manager mode
      managerBridge.setManagerMode(sessionId, true);
      managerBridge.handleManagerQuestion(sessionId, pendingQuestion);

      // Start polling
      session.startPolling(sessionId);

      return {
        content: [{ type: 'text', text: `Question sent to manager: ${question}` }],
        details: { questionId: pendingQuestion.id, sessionId },
      };
    },
  });
}

// ============================================
// TOOL: answer_manager_question
// ============================================

export function registerAnswerManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'answer_manager_question',
    label: 'Answer Manager Question',
    description: 'Answer a pending question from a sub-agent. The manager decides if they can answer or should forward to user.',
    parameters: Type.Object({
      subagentSessionId: Type.String({ description: 'Session ID of the sub-agent' }),
      questionId: Type.String({ description: 'ID of the question to answer' }),
      answer: Type.String({ description: 'Your answer to the sub-agent' }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { subagentSessionId, questionId, answer } = params;

      // Check for pending questions
      const pending = session.getUnansweredManagerQuestions(subagentSessionId);
      const question = pending.find(q => q.id === questionId);

      if (!question) {
        return {
          content: [{ type: 'text', text: `Question ${questionId} not found or already answered.` }],
          isError: true,
        };
      }

      // Answer the question
      managerBridge.managerAnswer(subagentSessionId, questionId, answer);

      return {
        content: [{ type: 'text', text: `Answered question ${questionId} for sub-agent ${subagentSessionId}.` }],
        details: { questionId, sessionId: subagentSessionId },
      };
    },
  });
}

// ============================================
// TOOL: forward_to_user
// ============================================

export function registerForwardToUserTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'forward_to_user',
    label: 'Forward to User',
    description: 'Forward a sub-agent question to the user. Use this when the manager cannot answer and needs user input.',
    parameters: Type.Object({
      subagentSessionId: Type.String({ description: 'Session ID of the sub-agent' }),
      questionId: Type.String({ description: 'ID of the question to forward' }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { subagentSessionId, questionId } = params;

      // Forward to user
      managerBridge.forwardQuestionToUser(subagentSessionId, questionId);

      return {
        content: [{ type: 'text', text: `Question ${questionId} forwarded to user. Waiting for response...` }],
        details: { questionId, sessionId: subagentSessionId },
      };
    },
  });
}

// ============================================
// TOOL: get_pending_manager_questions
// ============================================

export function registerGetPendingManagerQuestionsTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'get_pending_manager_questions',
    label: 'Get Pending Manager Questions',
    description: 'Get all pending questions from sub-agents waiting for manager response.',
    parameters: Type.Object({}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const pending = managerBridge.getAllPendingManagerQuestions();

      if (pending.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pending manager questions.' }],
        };
      }

      const formatted = pending.map(p => {
        return `[${p.sessionId}] ${p.subagentId}: ${p.question.question}`;
      }).join('\n');

      return {
        content: [{ type: 'text', text: `Pending questions:\n\n${formatted}` }],
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
  registerForwardToUserTool(api);
  registerGetPendingManagerQuestionsTool(api);
}