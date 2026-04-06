// ============================================
// TOOLS: run_subagents, ask_manager_question, answer_manager_question
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
        const results = await Promise.all(
          tasks.map(async (task, index) => {
            const result = spawn.spawnSubagent(task.description, {
              cwd: ctx.cwd,
              agent: task.agent,
              mode: task.mode || 'user',
            });

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
// TOOL: ask_manager_question (for subagents)
// ============================================

export function registerAskManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'ask_manager_question',
    label: 'Ask Manager',
    description: 'Subagent asks the manager (parent agent) for help or clarification. The manager will decide whether to answer directly or forward to user.',
    parameters: Type.Object({
      sessionId: Type.String({ description: 'Session ID of the sub-agent' }),
      question: Type.String({ description: 'Question to ask the manager' }),
      context: Type.Optional(Type.String({ description: 'Additional context for the question' })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { sessionId, question, context } = params;

      const pendingQuestion = session.addQuestion(sessionId, {
        type: 'manager',
        question,
        context,
      });

      managerBridge.setManagerMode(sessionId, true);
      managerBridge.handleManagerQuestion(sessionId, pendingQuestion);
      session.startPolling(sessionId);

      return {
        content: [{ type: 'text', text: `Question sent to manager: ${question}` }],
        details: { questionId: pendingQuestion.id, sessionId },
      };
    },
  });
}

// ============================================
// TOOL: answer_manager_question (for manager)
// ============================================

export function registerAnswerManagerQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'answer_manager_question',
    label: 'Answer Manager Question',
    description: 'Manager answers a pending question from a sub-agent. Use this when you can provide a direct answer.',
    parameters: Type.Object({
      subagentSessionId: Type.String({ description: 'Session ID of the sub-agent' }),
      questionId: Type.String({ description: 'ID of the question to answer' }),
      answer: Type.String({ description: 'Your answer to the sub-agent' }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { subagentSessionId, questionId, answer } = params;

      const pending = session.getUnansweredManagerQuestions(subagentSessionId);
      const question = pending.find(q => q.id === questionId);

      if (!question) {
        return {
          content: [{ type: 'text', text: `Question ${questionId} not found or already answered.` }],
          isError: true,
        };
      }

      managerBridge.managerAnswer(subagentSessionId, questionId, answer);

      return {
        content: [{ type: 'text', text: `Answered question ${questionId} for sub-agent ${subagentSessionId}.` }],
        details: { questionId, sessionId: subagentSessionId },
      };
    },
  });
}

// ============================================
// TOOL: ask_user_question (for manager to ask user)
// ============================================

export function registerAskUserQuestionTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'ask_user_question',
    label: 'Ask User',
    description: 'Manager asks the user a question. Use this when the sub-agent needs user input and you decide to forward it.',
    parameters: Type.Object({
      question: Type.String({ description: 'Question to ask the user' }),
      subagentSessionId: Type.String({ description: 'Session ID of the sub-agent that needs the answer' }),
      questionId: Type.String({ description: 'ID of the question to update with the user answer' }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { question, subagentSessionId, questionId } = params;

      // This tool shows the question to the user
      // The user will answer, and we need to capture that
      // For now, we return with a note that user interaction is needed
      
      // In a full implementation, this would integrate with the ask_user_question extension
      // For now, we forward the question to user and wait
      
      ctx.ui.notify(`User question from sub-agent ${subagentSessionId}: ${question}`, 'info');

      return {
        content: [{ type: 'text', text: `Question sent to user: "${question}". Waiting for response...` }],
        details: { sessionId: subagentSessionId, questionId },
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
  registerAskUserQuestionTool(api);
  registerGetPendingManagerQuestionsTool(api);
}