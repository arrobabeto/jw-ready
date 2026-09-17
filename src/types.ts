export type SessionKind = 'discovery' | 'deepening' | 'application' | 'comment' | 'review';
export type SessionStatus = 'active' | 'completed' | 'paused' | 'safe_mode';
export type NodeType = 'deterministic' | 'llm';

export interface NodeConfig {
  id: string; version: string; type: NodeType; enabled: boolean;
  model?: { name: string; reasoning_effort?: string };
  instructions: string; rules: string[]; examples?: unknown[];
  input_schema: Record<string, unknown>; output_schema: Record<string, unknown>;
  allowed_tools: string[]; retrieval_policy?: Record<string, unknown>;
  guardrails: string[]; evaluation_suite: string[]; fallback_behavior?: string;
}

export interface SourceExcerpt { id: string; url: string; title?: string; text: string; anchor?: string; host: string; }
export interface WeeklyMaterial { id: string; weekStart: string; weekEnd: string; meeting: 'midweek' | 'weekend'; title: string; url: string; sections: Array<{ title: string; text: string; sourceIds: string[] }>; excerpts: SourceExcerpt[]; validated: boolean; hash: string; }
export interface UserSettings { id: number; displayName: string; timezone: string; studyTime: string; midweekDay: number; weekendDay: number; }
export interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; sourceIds: string[]; createdAt: string; }
export interface StudySession { id: string; userId: number; weekId?: string; kind: SessionKind; status: SessionStatus; startedAt: string; endedAt?: string; nodeVersions: Record<string, string>; messages: Message[]; snapshot?: { nodes: Record<string, NodeConfig>; material?: WeeklyMaterial; minutes: number; targetTurns?: number }; }
export interface MemoryItem { id: string; userId: number; kind: string; text: string; sourceMessageIds: string[]; saved: boolean; expiresAt?: string; createdAt: string; }
export interface FeedbackCase { id: string; userId: number; nodeId: string; nodeVersion: string; rating: 'up' | 'down'; reason?: string; correction?: string; payload: Record<string, unknown>; createdAt: string; }
export interface Candidate { id: string; nodeId: string; baseVersion: string; candidateVersion: string; yaml: string; evaluation: Record<string, unknown>; status: 'pending' | 'accepted' | 'rejected'; }

export const OFFICIAL_HOSTS = new Set(['www.jw.org', 'jw.org', 'wol.jw.org', 'b.jw-cdn.org', 'cms-imgp.jw-cdn.org']);
