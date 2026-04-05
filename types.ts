// Core type definitions for interactive-team extension

export interface SessionState {
  sessionId: string;
  subagentId: string;
  status: 'idle' | 'running' | 'waiting_manager' | 'waiting_user' | 'complete' | 'error';
  pendingQuestions: PendingQuestion[];
  lastActivity: number;
}

export interface PendingQuestion {
  id: string;
  type: 'manager' | 'user';
  question: string;
  timestamp: number;
  answer?: string;
  answeredAt?: number;
}

export interface SubagentConfig {
  agentName: string;
  task: string;
  sessionFile: string;
  parentSessionId?: string;
}

export interface BridgeEvent {
  type: 'question_asked' | 'answer_received' | 'subagent_complete' | 'subagent_error';
  subagentId: string;
  payload: unknown;
  timestamp: number;
}