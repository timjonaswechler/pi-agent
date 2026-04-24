// ============================================
// UNIFIED TYPES FOR PI-AGENT
// ============================================

export type SpawnType = 'solo' | 'team';

export interface SessionState {
  sessionId: string;
  subagentId: string;
  agentProfile?: string;
  spawnType?: SpawnType;
  teamName?: string;
  status: SessionStatus;
  pendingQuestions: PendingQuestion[];
  parentSessionId?: string;
  rootSessionId: string;
  reason?: string;
  createdAt: number;
  lastActivity: number;
  pid?: number;
}

export type SessionStatus =
  | 'idle'            // Created, not started
  | 'running'         // Actively working
  | 'waiting_manager' // Waiting for manager answer
  | 'waiting_user'    // Waiting for user answer
  | 'complete'        // Finished successfully
  | 'error'           // Finished with error (crash, non-zero exit)
  | 'killed'          // Manually cancelled
  | 'timeout'         // Exceeded timeout
  | 'orphaned';       // Parent crashed; child state unknown

export interface PendingQuestion {
  id: string;
  type: 'manager' | 'user';
  question: string;
  context?: string;
  spawnType?: SpawnType;
  teamName?: string;
  agentProfile?: string;
  timestamp: number;
  answer?: string;
  answeredAt?: number;
}

export interface SubagentResult {
  sessionId: string;
  agent: string;
  task: string;
  success: boolean;
  output: string;
  error?: string;
  reason?: string;
  elapsedMs: number;
  pendingQuestions: Array<{ questionId: string; question: string }>;
}
