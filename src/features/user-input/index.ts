import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import registerAskUserQuestionTool from './askuserquestion/index.ts';

export function registerUserInputTools(api: ExtensionAPI): void {
  try {
    registerAskUserQuestionTool(api);
  } catch (error) {
    // Avoid hard failure if another extension already registered ask_user_question
    console.warn('[pi-agent] ask_user_question tool registration skipped:', error);
  }
}
