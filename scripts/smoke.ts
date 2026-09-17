import 'dotenv/config';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';
import {loadNodes} from '../src/config.js';
import {LlmClient} from '../src/llm.js';
import {StudyService,SAFE_MESSAGE} from '../src/study.js';
import {discoverCurrentWeek} from '../src/planner.js';
const store=new MemoryStore(),nodes=loadNodes(),llm=new LlmClient();
const user={id:999901,displayName:'Prueba local',timezone:'America/Mexico_City',studyTime:'19:00',midweekDay:3,weekendDay:6};
await store.upsertUser(user);
try {
 const materials=await discoverCurrentWeek(store);
 assert.equal(materials.length,2);console.log('PASS official ingestion: both meetings');
 const service=new StudyService(store,nodes,llm);
 for(const kind of ['discovery','deepening','application','comment','review'] as const) {
   const m=materials.find(x=>x.meeting===(kind==='comment'?'weekend':'midweek'))!;
   const first=await service.begin(user,kind,m);
   assert.notEqual(first.text,SAFE_MESSAGE,'Initial '+kind+' failed validation: '+service.lastFailure);
   const session=await store.getActiveSession(user.id);
   assert.ok(session,'Session should be active');
   const next=await service.respond(session,'Me llama la atención que la obediencia fuera constante. ¿Cómo puedo investigar esa idea en el texto?');
   assert.notEqual(next.text,SAFE_MESSAGE,'Followup '+kind+' failed validation');
   await service.finish((await store.getActiveSession(user.id))??session);
   console.log('PASS real model: '+kind+' start, reply, verification, completion');
 }
 const guided=await service.begin(user,'discovery',materials.find(x=>x.meeting==='midweek')!,5);
 assert.match(guided.text,/Paso 1 de 3/);
 for(let step=2;step<=3;step++) {
   const current=await store.getActiveSession(user.id);assert.ok(current);
   const answer=await service.respond(current,'Mi respuesta razonada del paso '+step+'.');
   assert.match(answer.text,new RegExp('Paso '+step+' de 3'));
 }
 const current=await store.getActiveSession(user.id);assert.ok(current);
 const closing=await service.respond(current,'Mi conclusión es que la obediencia debe ser constante.');
 assert.match(closing.text,/Sesión terminada/);assert.equal(await store.getActiveSession(user.id),undefined);
 console.log('PASS real guided session: 3 steps, explicit progress and controlled closing');
 const telegram=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/getMe');
 assert.equal((await telegram.json() as {ok:boolean}).ok,true);console.log('PASS Telegram getMe (no message sent)');
 console.log('PASS memories: '+(await store.getMemories(user.id)).filter(m=>m.kind==='weekly').length);
} catch(e) { console.error(e instanceof assert.AssertionError?e.message:'Live service failed; secrets omitted');process.exitCode=1; }
