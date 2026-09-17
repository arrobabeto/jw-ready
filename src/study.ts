import { LlmClient } from './llm.js';
import { newId, type Store } from './store.js';
import { nodeVersions, runNode } from './nodes.js';
import { coachOutput, verifierOutput } from './contracts.js';
import { validateMaterial } from './sources.js';
import type { Message, NodeConfig, SessionKind, StudySession, UserSettings, WeeklyMaterial } from './types.js';
export const nodeForKind:Record<SessionKind,string> = {discovery:'discovery_coach',deepening:'deepening_researcher',application:'application_coach',comment:'comment_composer',review:'review_generator'};
export const SAFE_MESSAGE = 'No tengo una respuesta respaldada por fuentes verificadas. Puedes consultar /fuentes o volver a intentarlo cuando el material esté disponible.';
const KIND_LABEL:Record<SessionKind,string>={discovery:'Descubrimiento',deepening:'Profundización',application:'Aplicación',comment:'Preparar comentario',review:'Repaso'};
export function targetTurns(kind:SessionKind,minutes:number) { if(minutes<=5)return 3;if(kind==='deepening')return 6;return 5; }
export function sessionProgress(session:StudySession) {
  const answered=session.messages.filter(m=>m.role==='user').length,total=session.snapshot?.targetTurns??targetTurns(session.kind,session.snapshot?.minutes??10);
  return {answered,total,step:Math.min(answered+1,total),completed:session.status==='completed'||answered>=total,label:KIND_LABEL[session.kind]};
}
export class StudyService {
  lastFailure?:string;
  constructor(private store: Store, private nodes: Map<string,NodeConfig>, private llm: LlmClient) {}
  async begin(user:UserSettings, kind:SessionKind, material?:WeeklyMaterial, minutes=10) {
    const existing = await this.store.getActiveSession(user.id);
    if(existing) {const progress=sessionProgress(existing);return {session:existing,text:`Ya tienes una sesión activa de ${progress.label.toLowerCase()} · paso ${progress.step} de ${progress.total}. Responde la pregunta o usa /terminar.`,nodeId:nodeForKind[existing.kind],nodeVersion:existing.nodeVersions[nodeForKind[existing.kind]],messageId:undefined,...progress};}
    if(!material || validateMaterial(material).length) return {session:undefined,text:SAFE_MESSAGE,nodeId:nodeForKind[kind],nodeVersion:this.nodes.get(nodeForKind[kind])!.version,messageId:undefined};
    const session:StudySession = {id:newId('session'),userId:user.id,weekId:material.weekStart,kind,status:'active',startedAt:new Date().toISOString(),nodeVersions:nodeVersions(this.nodes),snapshot:{nodes:structuredClone(Object.fromEntries(this.nodes)),material:structuredClone(material),minutes,targetTurns:targetTurns(kind,minutes)},messages:[]};
    await this.store.createSession(session);
    return {session,...await this.turn(session)};
  }
  async respond(session:StudySession,userText:string,material?:WeeklyMaterial) {
    if(session.status!=='active') throw new Error('Session is not active');
    await this.append(session,{id:newId('msg'),role:'user',text:userText,sourceIds:[],createdAt:new Date().toISOString()});
    return this.turn(session,material);
  }
  async finish(session:StudySession) {
    await this.store.finishSession(session.id); session.status='completed';
    const messages=session.messages.filter(m=>m.role==='user');
    if(!messages.length) return;
    try {
      this.lastFailure=undefined;
      const result=await runNode(this.sessionNodes(session),this.llm,'memory_extractor',{messages:messages.map(m=>({id:m.id,text:m.text}))});
      const items=result.json?.items;
      if(Array.isArray(items)) for(const item of items.slice(0,8)) {
        if(typeof item.text!=='string'||!Array.isArray(item.sourceMessageIds)||!item.sourceMessageIds.length||!item.sourceMessageIds.every((id:string)=>messages.some(m=>m.id===id))) continue;
        await this.store.saveMemory({id:newId('memory'),userId:session.userId,kind:'weekly',text:item.text,sourceMessageIds:item.sourceMessageIds,saved:false,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90*86400000).toISOString()});
      }
    } catch { /* Completion remains durable if summarization is unavailable. */ }
  }
  private sessionNodes(s:StudySession) { return s.snapshot ? new Map(Object.entries(s.snapshot.nodes)) : this.nodes; }
  private async turn(session:StudySession,fallback?:WeeklyMaterial) {
    const nodes=this.sessionNodes(session), nodeId=nodeForKind[session.kind], node=nodes.get(nodeId)!;
    const material=session.snapshot?.material ?? fallback;
    const progress=sessionProgress(session),mustFinish=progress.answered>=progress.total;
    const base={nodeId,nodeVersion:node.version,messageId:undefined as string|undefined,raw:undefined as Record<string,unknown>|undefined,...progress};
    if(!material||validateMaterial(material).length) return {...base,text:SAFE_MESSAGE};
    const memories=(await this.store.getMemories(session.userId)).filter(m=>m.kind!=='trace').slice(0,20);
    const saved=await this.store.listComments(session.userId);
    const phase=progress.answered===0?'opening':mustFinish?'closing':'exploration';
    const input={kind:session.kind,conversation:session.messages.slice(-16),memories,savedComments:saved.slice(0,10),remainingMinutes:Math.max(0,(session.snapshot?.minutes??10)-(Date.now()-Date.parse(session.startedAt))/60000),sessionPlan:{phase,step:progress.step,total:progress.total,mustContinue:!mustFinish,mustFinish}};
    const runtimeInstructions=mustFinish
      ? `Esta es la fase de cierre tras ${progress.answered} respuestas del usuario. Sintetiza en 2 a 4 frases una idea que el usuario realmente construyó. No hagas ninguna pregunta: nextQuestion debe ser "" y done debe ser true.`
      : phase==='opening'
        ? `Este es el paso 1 de ${progress.total}. Da solo el contexto mínimo respaldado por las fuentes y termina con una pregunta abierta concreta. nextQuestion no puede estar vacío y done debe ser false.`
        : `Este es el paso ${progress.step} de ${progress.total}. Empieza reconociendo con precisión una idea de la última respuesta del usuario, añade una conexión breve respaldada y termina con una sola pregunta que profundice. No redactes todavía un cierre. nextQuestion no puede estar vacío y done debe ser false.`;
    try {
      let result=await runNode(nodes,this.llm,nodeId,input,material.excerpts,runtimeInstructions);
      const allowedUserIds=session.messages.filter(m=>m.role==='user').map(m=>m.id);
      const first=coachOutput.safeParse(result.json);
      const invalidConversation=first.success&&(first.data.userMessageIds.some(id=>!allowedUserIds.includes(id))||first.data.sourceIds.some(id=>!material.excerpts.some(s=>s.id===id))||(mustFinish?(!first.data.done||Boolean(first.data.nextQuestion.trim())):(first.data.done||!first.data.nextQuestion.trim())));
      if(!first.success || invalidConversation) {
        result=await runNode(nodes,this.llm,nodeId,{...input,repair:'Corrige el esquema, los IDs o la fase conversacional. Usa solo los IDs permitidos. No añadas afirmaciones nuevas.',allowedUserIds,allowedSourceIds:material.excerpts.map(s=>s.id)},material.excerpts,runtimeInstructions);
      }
      let output=coachOutput.parse(result.json);
      const userIds=new Set(session.messages.filter(m=>m.role==='user').map(m=>m.id));
      const validateOutput=()=>{
      if(output.sourceIds.some(id=>!material.excerpts.some(s=>s.id===id))) throw new Error('Unknown source');
      if(output.userMessageIds.some(id=>!userIds.has(id))) throw new Error('Unknown user message');
      if(session.kind==='comment'&&output.done&&!output.userMessageIds.length) throw new Error('Comment lacks user provenance');
      if(mustFinish?(!output.done||Boolean(output.nextQuestion.trim())):(output.done||!output.nextQuestion.trim())) throw new Error('Invalid conversation phase');
      };validateOutput();
      const render=()=>output.message+(output.nextQuestion&&!output.message.includes(output.nextQuestion)?'\n\n'+output.nextQuestion:'');
      let content=render();
      const verify=async()=>verifierOutput.parse((await runNode(nodes,this.llm,'source_verifier',{response:content,sourceIds:output.sourceIds,conversation:session.messages},material.excerpts)).json);
      let verification=await verify();
      if(verification.status!=='pass') {
        // A single grounded revision is allowed; it must pass the same gate.
        result=await runNode(nodes,this.llm,nodeId,{...input,previousOutput:output,verificationFeedback:verification.reason,repair:'Reformula eliminando afirmaciones sin respaldo. Cita fragmentos que sí sostengan cada afirmación. Si falta información, reconócelo y formula una pregunta sin presuponer hechos. No afirmes haber guardado nada ni realizado acciones.',allowedUserIds,allowedSourceIds:material.excerpts.map(s=>s.id)},material.excerpts,runtimeInstructions);
        output=coachOutput.parse(result.json);validateOutput();content=render();verification=await verify();
      }
      if(verification.status!=='pass') throw new Error('Unverified response');
      const id=newId('msg');
      const citations=output.sourceIds.map(sourceId=>{const s=material.excerpts.find(e=>e.id===sourceId)!;return s.url+(s.anchor??'');});
      const storedText=content+(citations.length?'\n\n📚 '+[...new Set(citations)].join('\n'):'');
      const elapsed=Math.max(1,Math.round((Date.now()-Date.parse(session.startedAt))/60000));
      const text=mustFinish
        ? `✅ Sesión terminada · ${elapsed} min\n\n💡 Idea que construiste\n${storedText}\n\nElige qué quieres hacer ahora:`
        : `📖 Sesión de hoy · ${progress.label} · Paso ${progress.step} de ${progress.total}\n\n${storedText}\n\nResponde con texto o audio; no necesitas repetir /hoy.`;
      await this.append(session,{id,role:'assistant',text:storedText,sourceIds:output.sourceIds,createdAt:new Date().toISOString()});
      await this.store.saveMemory({id,userId:session.userId,kind:'trace',text:JSON.stringify({nodeId,nodeVersion:node.version,input,sources:material.excerpts,output:result.json}),sourceMessageIds:[id],saved:false,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90*86400000).toISOString()});
      if(mustFinish) await this.finish(session);
      return {...base,text,messageId:id,raw:result.json,completed:mustFinish};
    } catch(e) { this.lastFailure=e instanceof Error ? e.name+(e.name==='ZodError'?': invalid output schema':e.message.startsWith('Unknown')||e.message==='Unverified response'?': '+e.message:'') : 'Unknown failure';return {...base,text:SAFE_MESSAGE}; }
  }
  private async append(session:StudySession,message:Message) { await this.store.appendMessage(session.id,message); session.messages.push(message); }
}
