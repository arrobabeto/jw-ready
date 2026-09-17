import crypto from 'node:crypto';
import pg from 'pg';
import type { Candidate, FeedbackCase, Message, MemoryItem, StudySession, UserSettings, WeeklyMaterial } from './types.js';

export interface Store {
  upsertUser(settings: UserSettings): Promise<void>;
  getUser(id: number): Promise<UserSettings | undefined>;
  getAnyUser(): Promise<UserSettings | undefined>;
  saveMaterial(material: WeeklyMaterial): Promise<void>;
  getMaterial(weekId: string, meeting?: string): Promise<WeeklyMaterial | undefined>;
  createSession(session: StudySession): Promise<void>;
  getActiveSession(userId: number): Promise<StudySession | undefined>;
  getLatestSession(userId: number): Promise<StudySession | undefined>;
  finishSession(id: string): Promise<void>;
  saveMemory(item: MemoryItem): Promise<void>;
  getMemories(userId: number): Promise<MemoryItem[]>;
  appendMessage(sessionId: string, message: Message): Promise<void>;
  addFeedback(feedback: FeedbackCase): Promise<void>;
  listFeedback(nodeId?: string): Promise<FeedbackCase[]>;
  saveComment(userId: number, text: string, sourceMessageIds: string[], sourceIds: string[]): Promise<void>;
  listComments(userId: number): Promise<Array<{ id: string; text: string; createdAt: string }>>;
  deleteMemory(userId: number, id?: string): Promise<void>;
  deleteAllUserData(userId: number): Promise<void>;
  exportUserData(userId: number): Promise<Record<string, unknown>>;
  saveCandidate(candidate: Candidate): Promise<void>;
  listCandidates(): Promise<Candidate[]>;
  updateCandidateStatus(id: string, status: Candidate['status']): Promise<void>;
  purgeExpired(): Promise<number>;
}

export class MemoryStore implements Store {
  memories: MemoryItem[] = [];
  users = new Map<number, UserSettings>(); materials = new Map<string, WeeklyMaterial>(); sessions = new Map<string, StudySession>();
  feedback: FeedbackCase[] = []; candidates: Candidate[] = [];
  async upsertUser(s: UserSettings) { this.users.set(s.id, s); }
  async getUser(id: number) { return this.users.get(id); }
  async getAnyUser() { return this.users.values().next().value; }
  async saveMaterial(m: WeeklyMaterial) { this.materials.set(m.id, m); }
  async getMaterial(weekId: string, meeting?: string) { return [...this.materials.values()].find((m) => m.weekStart === weekId && (!meeting || m.meeting === meeting)); }
  async createSession(s: StudySession) { this.sessions.set(s.id, structuredClone(s)); }
  async getActiveSession(userId: number) { return structuredClone([...this.sessions.values()].find((s) => s.userId === userId && s.status === 'active')); }
  async getLatestSession(userId: number) { return structuredClone([...this.sessions.values()].filter(s => s.userId === userId).at(-1)); }
  async finishSession(id: string) { const s = this.sessions.get(id); if(s) { s.status = 'completed'; s.endedAt = new Date().toISOString(); } }
  async saveMemory(item: MemoryItem) { this.memories.push(structuredClone(item)); }
  async getMemories(userId: number) { return this.memories.filter(m => m.userId === userId && (m.saved || !m.expiresAt || Date.parse(m.expiresAt) > Date.now())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  async appendMessage(id: string, m: Message) { const s = this.sessions.get(id); if (s) s.messages.push(m); }
  async addFeedback(f: FeedbackCase) { this.feedback.push(f); }
  async listFeedback(nodeId?: string) { return nodeId ? this.feedback.filter((f) => f.nodeId === nodeId) : this.feedback; }
  async saveComment(userId: number, text: string, sourceMessageIds: string[], sourceIds: string[]) { (this as any).comments ??= []; (this as any).comments.push({ id: newId('comment'), userId, text, sourceMessageIds, sourceIds, createdAt: new Date().toISOString() }); }
  async listComments(userId: number) { return ((this as any).comments ?? []).filter((c: any) => c.userId === userId); }
  async deleteMemory(userId: number, id?: string) { this.memories = this.memories.filter(m => m.userId !== userId || (id ? m.id !== id : m.saved)); }
  async deleteAllUserData(userId: number) { this.users.delete(userId); for (const [id, s] of this.sessions) if (s.userId === userId) this.sessions.delete(id); this.feedback = this.feedback.filter((f) => f.userId !== userId);this.memories=this.memories.filter(m=>m.userId!==userId);this.candidates=[]; (this as any).comments = ((this as any).comments ?? []).filter((c: any) => c.userId !== userId); }
  async exportUserData(userId: number) { return { user: this.users.get(userId), sessions: [...this.sessions.values()].filter((s) => s.userId === userId), feedback: this.feedback.filter((f) => f.userId === userId), comments: await this.listComments(userId) }; }
  async saveCandidate(c: Candidate) { this.candidates.push(c); }
  async listCandidates() { return this.candidates; }
  async updateCandidateStatus(id: string, status: Candidate['status']) { const c = this.candidates.find((x) => x.id === id); if (c) c.status = status; }
  async purgeExpired() { const cutoff = Date.now() - 90*86400000; let count = 0; for(const [id,s] of this.sessions) { if(Date.parse(s.startedAt) < cutoff) {count += s.messages.length; this.sessions.delete(id);} } this.memories = this.memories.filter(m=>m.saved || !m.expiresAt || Date.parse(m.expiresAt)>Date.now()); return count; }
}

export class PgStore implements Store {
  constructor(private pool: pg.Pool) {}
  async upsertUser(s: UserSettings) { await this.pool.query(`INSERT INTO users(id,display_name,timezone,study_time,midweek_day,weekend_day) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET display_name=$2,timezone=$3,study_time=$4,midweek_day=$5,weekend_day=$6`, [s.id,s.displayName,s.timezone,s.studyTime,s.midweekDay,s.weekendDay]); }
  async getUser(id: number) { const r = await this.pool.query('SELECT id,display_name as "displayName",timezone,study_time as "studyTime",midweek_day as "midweekDay",weekend_day as "weekendDay" FROM users WHERE id=$1', [id]); return r.rows[0] ? {...r.rows[0],id:Number(r.rows[0].id)} as UserSettings : undefined; }
  async getAnyUser() { const r = await this.pool.query('SELECT id,display_name as "displayName",timezone,study_time as "studyTime",midweek_day as "midweekDay",weekend_day as "weekendDay" FROM users ORDER BY created_at LIMIT 1'); return r.rows[0] ? {...r.rows[0],id:Number(r.rows[0].id)} as UserSettings : undefined; }
  async saveMaterial(m: WeeklyMaterial) { await this.pool.query(`INSERT INTO weekly_material(id,week_start,week_end,meeting,title,payload,validated,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET payload=$6,validated=$7,source_hash=$8,fetched_at=now()`, [m.id,m.weekStart,m.weekEnd,m.meeting,m.title,JSON.stringify(m),m.validated,m.hash]); }
  async getMaterial(weekId: string, meeting?: string) { const r = await this.pool.query(`SELECT payload FROM weekly_material WHERE week_start=$1 ${meeting ? 'AND meeting=$2' : ''} ORDER BY fetched_at DESC LIMIT 1`, meeting ? [weekId, meeting] : [weekId]); return r.rows[0]?.payload as WeeklyMaterial | undefined; }
  async createSession(s: StudySession) { await this.pool.query('INSERT INTO sessions(id,user_id,week_id,kind,status,started_at,node_versions) VALUES($1,$2,$3,$4,$5,$6,$7)', [s.id,s.userId,s.weekId,s.kind,s.status,s.startedAt,JSON.stringify({...s.nodeVersions, __snapshot: s.snapshot})]); }
  async getActiveSession(userId: number) { return this.readSession(userId, true); }
  async getLatestSession(userId: number) { return this.readSession(userId, false); }
  private async readSession(userId: number, active: boolean): Promise<StudySession | undefined> {
    const r = await this.pool.query("SELECT * FROM sessions WHERE user_id=$1" + (active ? " AND status='active'" : "") + " ORDER BY started_at DESC LIMIT 1", [userId]);
    const row = r.rows[0]; if (!row) return undefined;
    const m = await this.pool.query('SELECT id,role,text,source_ids as "sourceIds",created_at as "createdAt" FROM messages WHERE session_id=$1 ORDER BY created_at,id',[row.id]);
    const { __snapshot, ...versions } = row.node_versions;
    return { id:row.id, userId:Number(row.user_id), weekId:row.week_id, kind:row.kind, status:row.status, startedAt:row.started_at.toISOString(), endedAt:row.ended_at?.toISOString(), nodeVersions:versions, snapshot:__snapshot, messages:m.rows.map(x=>({...x,createdAt:x.createdAt.toISOString()})) };
  }
  async finishSession(id: string) { await this.pool.query("UPDATE sessions SET status='completed',ended_at=now() WHERE id=$1", [id]); }
  async saveMemory(m: MemoryItem) { await this.pool.query('INSERT INTO memory_items(id,user_id,kind,text,source_message_ids,saved,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[m.id,m.userId,m.kind,m.text,JSON.stringify(m.sourceMessageIds),m.saved,m.expiresAt,m.createdAt]); }
  async getMemories(userId: number): Promise<MemoryItem[]> { const r = await this.pool.query('SELECT id,user_id,kind,text,source_message_ids,saved,expires_at,created_at FROM memory_items WHERE user_id=$1 AND (saved OR expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC',[userId]); return r.rows.map(m=>({id:m.id,userId:Number(m.user_id),kind:m.kind,text:m.text,sourceMessageIds:m.source_message_ids,saved:m.saved,expiresAt:m.expires_at?.toISOString(),createdAt:m.created_at.toISOString()})); }
  async appendMessage(id: string, m: Message) { await this.pool.query('INSERT INTO messages(id,session_id,role,text,source_ids,created_at) VALUES($1,$2,$3,$4,$5,$6)', [m.id,id,m.role,m.text,JSON.stringify(m.sourceIds),m.createdAt]); }
  async addFeedback(f: FeedbackCase) { await this.pool.query('INSERT INTO feedback_cases(id,user_id,node_id,node_version,rating,reason,correction,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [f.id,f.userId,f.nodeId,f.nodeVersion,f.rating,f.reason,f.correction,JSON.stringify(f.payload)]); }
  async listFeedback(nodeId?: string) { const r = await this.pool.query(`SELECT id,user_id as "userId",node_id as "nodeId",node_version as "nodeVersion",rating,reason,correction,payload,created_at as "createdAt" FROM feedback_cases ${nodeId ? 'WHERE node_id=$1' : ''} ORDER BY created_at`, nodeId ? [nodeId] : []); return r.rows as FeedbackCase[]; }
  async saveComment(userId: number, text: string, sourceMessageIds: string[], sourceIds: string[]) { await this.pool.query('INSERT INTO saved_comments(id,user_id,text,source_message_ids,source_ids) VALUES($1,$2,$3,$4,$5)', [newId('comment'),userId,text,JSON.stringify(sourceMessageIds),JSON.stringify(sourceIds)]); }
  async listComments(userId: number) { const r = await this.pool.query('SELECT id,text,created_at as "createdAt" FROM saved_comments WHERE user_id=$1 ORDER BY created_at DESC', [userId]); return r.rows; }
  async deleteMemory(userId: number, id?: string) { await this.pool.query('DELETE FROM memory_items WHERE user_id=$1 '+(id?'AND id=$2':'AND saved=false'), id?[userId,id]:[userId]); }
  async deleteAllUserData(userId: number) { const c=await this.pool.connect(); try {await c.query('BEGIN');await c.query('DELETE FROM node_candidates');await c.query('DELETE FROM users WHERE id=$1',[userId]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();} }
  async exportUserData(userId: number) { const [u,s,m,f,c] = await Promise.all([this.pool.query('SELECT * FROM users WHERE id=$1',[userId]),this.pool.query('SELECT * FROM sessions WHERE user_id=$1',[userId]),this.pool.query('SELECT * FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)',[userId]),this.pool.query('SELECT * FROM feedback_cases WHERE user_id=$1',[userId]),this.pool.query('SELECT * FROM saved_comments WHERE user_id=$1',[userId])]); return { user:u.rows[0], sessions:s.rows, messages:m.rows, feedback:f.rows, comments:c.rows }; }
  async saveCandidate(c: Candidate) { await this.pool.query('INSERT INTO node_candidates(id,node_id,base_version,candidate_version,yaml,evaluation,status) VALUES($1,$2,$3,$4,$5,$6,$7)', [c.id,c.nodeId,c.baseVersion,c.candidateVersion,c.yaml,JSON.stringify(c.evaluation),c.status]); }
  async listCandidates() { const r = await this.pool.query('SELECT id,node_id as "nodeId",base_version as "baseVersion",candidate_version as "candidateVersion",yaml,evaluation,status FROM node_candidates ORDER BY created_at DESC'); return r.rows as Candidate[]; }
  async updateCandidateStatus(id: string, status: Candidate['status']) { await this.pool.query('UPDATE node_candidates SET status=$2 WHERE id=$1',[id,status]); }
  async purgeExpired() { const r = await this.pool.query(`WITH gone AS (DELETE FROM messages WHERE created_at < now() - interval '90 days' RETURNING id) SELECT count(*)::int AS count FROM gone`); await this.pool.query(`DELETE FROM memory_items WHERE saved=false AND expires_at < now()`);await this.pool.query("DELETE FROM sessions WHERE started_at<now()-interval '90 days'");await this.pool.query("DELETE FROM weekly_material WHERE week_end<current_date-90"); return r.rows[0]?.count ?? 0; }
}

export function newId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
