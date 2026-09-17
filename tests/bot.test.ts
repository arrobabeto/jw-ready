import test from 'node:test';import assert from 'node:assert/strict';import {Bot} from 'grammy';
import {StudyBot} from '../src/bot.js';import {MemoryStore} from '../src/store.js';import {loadNodes} from '../src/config.js';
import {dailyPlan} from '../src/schedule.js';import {FakeLlm,user,material} from './helpers.js';
async function fixture(){
 const st=new MemoryStore(),llm=new FakeLlm(),replies:Array<{method:string;payload:any}>=[],bot=new Bot('123:fake',{botInfo:{id:123,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false} as any});
 bot.api.config.use(async(_prev,method,payload)=>{replies.push({method,payload});return {ok:true,result:{message_id:replies.length,date:0,chat:{id:user.id,type:'private'},text:'ok'}} as any;});
 const app=new StudyBot('123:fake',st,llm,undefined,loadNodes(),bot);
 const plan=dailyPlan(user);await st.saveMaterial({...material,id:plan.meeting+':'+plan.week,meeting:plan.meeting,weekStart:plan.week});
 let id=0;
 const send=async(text:string,uid=user.id)=>bot.handleUpdate({update_id:++id,message:{message_id:id,date:0,chat:{id:uid,type:'private',first_name:'Test'},from:{id:uid,is_bot:false,first_name:'Test'},text,...(text.startsWith('/')?{entities:[{type:'bot_command' as const,offset:0,length:text.split(' ')[0].length}]}:{})}});
 return {app,st,llm,bot,replies,send};
}
test('Telegram common flow: pair, configure, study, feedback, doubt, save, finish, export',async()=>{
 const f=await fixture();await f.send('/start');assert.equal((await f.st.getAnyUser())!.id,user.id);
 await f.send('/configurar 19:00 3 6 America/Mexico_City');await f.send('/hoy');
 assert.ok(await f.st.getActiveSession(user.id));await f.send('Me llamó la atención su obediencia.');
 const keyboard=f.replies.at(-1)!.payload.reply_markup;assert.ok(keyboard.inline_keyboard[0][0].callback_data.length<=64);
 await f.bot.handleUpdate({update_id:80,callback_query:{id:'cb',chat_instance:'x',from:{id:user.id,is_bot:false,first_name:'Test'},message:{message_id:80,date:0,chat:{id:user.id,type:'private',first_name:'Test'}},data:keyboard.inline_keyboard[0][1].callback_data}});
 const fb=(await f.st.listFeedback())[0];assert.ok(fb.payload.output);assert.ok(fb.payload.input);assert.ok(fb.payload.sources);
 await f.send('/feedback '+fb.id+' Haz preguntas más cortas');assert.equal((await f.st.listFeedback()).at(-1)!.correction,'Haz preguntas más cortas');
 await f.send('/duda ¿Por qué obedecieron?');assert.ok((await f.st.getMemories(user.id)).some(m=>m.kind==='question'));
 await f.send('/guardar Mi idea sobre obediencia');await f.send('/comentarios');assert.match(f.replies.at(-1)!.payload.text,/Mi idea/);
 await f.send('/terminar');assert.equal(await f.st.getActiveSession(user.id),undefined);
 await f.send('/exportar');assert.equal(f.replies.at(-1)!.method,'sendDocument');
 await f.send('/olvidar');assert.ok((await f.st.getMemories(user.id)).every(m=>m.saved));
 await f.send('/borrar_todo CONFIRMAR');assert.equal(await f.st.getUser(user.id),undefined);assert.equal((await f.st.getMemories(user.id)).length,0);
});
test('unauthorized user and group do not claim existing owner',async()=>{const f=await fixture();await f.send('/start');const n=f.replies.length;await f.send('/hoy',888);assert.equal(f.replies.length,n);});
test('scheduled notification deduplicates persistently',async()=>{
 const f=await fixture();await f.send('/start');await f.st.upsertUser({...user,timezone:'UTC',studyTime:'19:00'});
 const when=new Date('2026-09-17T19:00:00Z'),plan=dailyPlan({...user,timezone:'UTC'},when);
 await f.st.saveMaterial({...material,id:plan.meeting+':'+plan.week,weekStart:plan.week,meeting:plan.meeting});
 await f.app.sendScheduled(when);const n=f.replies.length;const s=await f.st.getActiveSession(user.id);if(s)await f.st.finishSession(s.id);
 await f.app.sendScheduled(when);assert.equal(f.replies.length,n);
});
test('voice update goes through transcription and study; excessive duration rejected',async()=>{
 const f=await fixture();await f.send('/start');await f.send('/hoy');
 f.bot.api.config.use(async(prev,method,payload,signal)=>method==='getFile'?{ok:true,result:{file_id:'x',file_unique_id:'x',file_path:'voice/test.ogg'}} as any:prev(method,payload,signal));
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('audio');
 try {
 for(const duration of [4,301]) await f.bot.handleUpdate({update_id:200+duration,message:{message_id:200+duration,date:0,chat:{id:user.id,type:'private',first_name:'Test'},from:{id:user.id,is_bot:false,first_name:'Test'},voice:{duration,file_id:'x',file_unique_id:'x',file_size:100}}});
 assert.match(f.replies.at(-1)!.payload.text,/5 minutos/);
 assert.ok((await f.st.getActiveSession(user.id))!.messages.some(m=>m.role==='user'&&m.text.includes('obediencia')));
 } finally {globalThis.fetch=original;}
});
test('guided session shows five steps, closes, and offers contextual actions',async()=>{
 const f=await fixture();await f.send('/start');await f.send('/ayuda');assert.match(f.replies.at(-1)!.payload.text,/5 pasos/);
 await f.send('/hoy');assert.match(f.replies.at(-1)!.payload.text,/Paso 1 de 5/);
 for(let step=2;step<=5;step++){await f.send('Mi respuesta del paso '+step);assert.match(f.replies.at(-1)!.payload.text,new RegExp('Paso '+step+' de 5'));assert.ok(await f.st.getActiveSession(user.id));}
 await f.send('Mi conclusión personal');assert.match(f.replies.at(-1)!.payload.text,/Sesión terminada/);assert.equal(await f.st.getActiveSession(user.id),undefined);
 const keyboard=f.replies.at(-1)!.payload.reply_markup.inline_keyboard.flat();
 assert.ok(keyboard.some((b:any)=>b.callback_data==='act:continue'));assert.ok(keyboard.some((b:any)=>b.callback_data==='act:deepening'));assert.ok(keyboard.some((b:any)=>b.callback_data==='act:application'));assert.ok(keyboard.some((b:any)=>b.callback_data==='act:comment'));
 const save=keyboard.find((b:any)=>b.callback_data.startsWith('act:save:'));
 await f.bot.handleUpdate({update_id:501,callback_query:{id:'save',chat_instance:'x',from:{id:user.id,is_bot:false,first_name:'Test'},message:{message_id:501,date:0,chat:{id:user.id,type:'private',first_name:'Test'}},data:save.callback_data}});
 assert.ok((await f.st.getMemories(user.id)).some(m=>m.kind==='saved_note'&&m.saved));
 await f.bot.handleUpdate({update_id:502,callback_query:{id:'deep',chat_instance:'x',from:{id:user.id,is_bot:false,first_name:'Test'},message:{message_id:502,date:0,chat:{id:user.id,type:'private',first_name:'Test'}},data:'act:deepening'}});
 assert.equal((await f.st.getActiveSession(user.id))!.kind,'deepening');assert.match(f.replies.at(-1)!.payload.text,/Paso 1 de 6/);
});
