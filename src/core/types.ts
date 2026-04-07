// ============================================
// UNIFIED TYPES FOR PI-AGENT
// ============================================

export interface SessionState {
  sessionId: string;
  subagentId: string;
  agentProfile?: string;
  status: SessionStatus;
  pendingQuestions: PendingQuestion[];
  parentSessionId?: string;
  createdAt: number;
  lastActivity: number;
}

export type SessionStatus = 
  | 'idle'           // Created, not started
  | 'running'        // Actively working
  | 'waiting_manager' // Waiting for manager answer
  | 'waiting_user'   // Waiting for user answer
  | 'complete'       // Finished successfully
  | 'error'          // Finished with error
  | 'killed';        // Forcefully stopped

export interface PendingQuestion {
  id: string;
  type: 'manager' | 'user';
  question: string;
  context?: string;
  timestamp: number;
  answer?: string;
  answeredAt?: number;
}

export interface SubagentResult {
  sessionId: string;
  agentName: string;
  task: string;
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  elapsedMs: number;
}

export interface TeamConfig {
  name: string;
  manager: string;
  members: string[];
  description?: string;
}

export interface TeamState {
  active: boolean;
  name: string;
  config: TeamConfig | null;
  activatedAt?: number;
}

export interface BridgeEvent {
  type: 'question_asked' | 'answer_received' | 'subagent_start' | 'subagent_complete' | 'subagent_error' | 'subagent_killed';
  sessionId: string;
  subagentId: string;
  payload?: unknown;
  timestamp: number;
}

// Tool parameter types
export interface RunSubagentsParams {
  tasks: Array<{
    description: string;
    agent?: string;
    mode?: 'user' | 'manager';
  }>;
}

export interface AskManagerParams {
  sessionId: string;
  question: string;
  context?: string;
}

export interface AnswerManagerParams {
  sessionId: string;
  questionId: string;
  answer: string;
}

export interface ForwardToUserParams {
  sessionId: string;
  questionId: string;
}

export interface SpawnAgentParams {
  agent: string;
  task: string;
  mode?: 'user' | 'manager';
}

export interface KillAgentParams {
  sessionId: string;
}