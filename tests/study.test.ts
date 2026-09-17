import test from 'node:test';import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';import {loadNodes} from '../src/config.js';
import {StudyService,SAFE_MESSAGE,nodeForKind} from '../src/study.js';
import {FakeLlm,user,material} from './helpers.js';
for(const kind of ['discovery','deepening','application','comment','review'] as const) test('study flow '+kind,async()=>{
 const store=new MemoryStore(),llm=new FakeLlm(),nodes=loadNodes(),service=new StudyService(store,nodes,llm);
 await store.upsertUser(user);
 const version=nodes.get(nodeForKind[kind])!.version;
 const begin=await service.begin(user,kind,material,5);assert.ok(begin.session);assert.match(begin.text,/Paso 1 de 3/);
 assert.equal((await store.getActiveSession(user.id))?.messages.length,1);
 nodes.get(nodeForKind[kind])!.version='9.0.0';
 let result=await service.respond((await store.getActiveSession(user.id))!,'Veo obediencia.');
 assert.equal(result.nodeVersion,version);assert.match(result.text,/Paso 2 de 3/);assert.ok(await store.getActiveSession(user.id));
 result=await service.respond((await store.getActiveSession(user.id))!,'Fue constante.');assert.match(result.text,/Paso 3 de 3/);
 result=await service.respond((await store.getActiveSession(user.id))!,'Quiero imitarla.');
 assert.match(result.text,/Sesión terminada/);assert.equal(await store.getActiveSession(user.id),undefined);
 assert.equal((await store.getLatestSession(user.id))!.messages.length,7);
 assert.ok((await store.getMemories(user.id)).some(m=>m.kind==='weekly'));
 assert.ok((await store.getMemories(user.id)).some(m=>m.kind==='trace'&&JSON.parse(m.text).input));
 await store.saveComment(user.id,'Veo obediencia.',[],['s1']);assert.equal((await store.listComments(user.id)).length,1);
});
test('missing sources never invokes model',async()=>{const l=new FakeLlm();const s=new StudyService(new MemoryStore(),loadNodes(),l);assert.equal((await s.begin(user,'discovery')).text,SAFE_MESSAGE);assert.equal(l.calls.length,0);});
for(const flag of ['malformed','reject','unknownSource'] as const) test('fails closed: '+flag,async()=>{const l=new FakeLlm();l[flag]=true;const s=new StudyService(new MemoryStore(),loadNodes(),l);assert.equal((await s.begin(user,'discovery',material)).text,SAFE_MESSAGE);});
test('one active session only',async()=>{const st=new MemoryStore(),l=new FakeLlm(),s=new StudyService(st,loadNodes(),l);await s.begin(user,'discovery',material);assert.match((await s.begin(user,'review',material)).text,/activa/);assert.equal(st.sessions.size,1);});
test('rejected content is revised once and verified before persistence',async()=>{
 const l=new FakeLlm(),original=l.run.bind(l);let checks=0;
 l.run=async(...args)=>{if(args[0].id==='source_verifier')l.reject=++checks===1;return original(...args);};
 const st=new MemoryStore(),s=new StudyService(st,loadNodes(),l);
 assert.notEqual((await s.begin(user,'deepening',material)).text,SAFE_MESSAGE);
 assert.equal(checks,2);assert.equal((await st.getActiveSession(user.id))!.messages.length,1);
 assert.ok(l.calls.some(c=>c.input.verificationFeedback));
});
test('repeated source rejection is bounded and never saved',async()=>{
 const l=new FakeLlm();l.reject=true;const st=new MemoryStore(),s=new StudyService(st,loadNodes(),l);
 assert.equal((await s.begin(user,'discovery',material)).text,SAFE_MESSAGE);
 assert.equal(l.calls.filter(c=>c.node.id==='source_verifier').length,2);
 assert.equal((await st.getActiveSession(user.id))!.messages.length,0);
});
test('an early model finish is repaired and cannot shorten the guided session',async()=>{
 class EarlyFinish extends FakeLlm {first=true;override async run(node:any,input:any,sources:any[]=[]){
  if(this.first&&node.id==='discovery_coach'){this.first=false;return {text:'',model:'test',json:{message:'Cierre prematuro.',nextQuestion:'',sourceIds:['s1'],userMessageIds:[],done:true}};}
  return super.run(node,input,sources);
 }}
 const st=new MemoryStore(),llm=new EarlyFinish(),service=new StudyService(st,loadNodes(),llm);
 const result=await service.begin(user,'discovery',material);
 assert.match(result.text,/Paso 1 de 5/);assert.ok(await st.getActiveSession(user.id));
 assert.ok(llm.calls.some(c=>Boolean(c.input.repair)));
});
