import {Bot,InlineKeyboard,InputFile,type Context} from 'grammy';
import {LlmClient} from './llm.js';
import {newId,type Store} from './store.js';
import {StudyService,nodeForKind,sessionProgress} from './study.js';
import {configure,dailyPlan,weekStart,localDate} from './schedule.js';
import {deepenMaterial} from './sources.js';
import type {NodeConfig,SessionKind,UserSettings,WeeklyMaterial} from './types.js';

export class StudyBot {
  readonly bot:Bot;
  private study:StudyService;
  private timer?:ReturnType<typeof setInterval>;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(token:string,private store:Store,private llm:LlmClient,private allowedUserId:number|undefined,nodes:Map<string,NodeConfig>,bot?:Bot) {
    this.bot=bot??new Bot(token); this.study=new StudyService(store,nodes,llm);
    this.bot.use(async(ctx,next)=>{
      const previous=this.queue; let release!:()=>void; this.queue=new Promise<void>(r=>release=r);
      await previous; try {await next();} finally {release();}
    });
    this.bot.use(async(ctx,next)=>{
      if(!ctx.from || ctx.chat?.type!=='private') return;
      if(!this.allowedUserId) {
        const owner=await store.getAnyUser();
        if(owner) this.allowedUserId=Number(owner.id);
        else if(/^\/start(?:\s|$)/.test(ctx.message?.text??'')) {
          await store.upsertUser(this.defaults(ctx)); this.allowedUserId=ctx.from.id;
        }
      }
      if(ctx.from.id!==this.allowedUserId) return;
      try {await next();} catch {await this.reply(ctx,'No pude completar la operación. Tus datos guardados se mantienen; puedes volver a intentarlo.');}
    });
    this.register();
    this.bot.catch(()=>console.error('Telegram update failed; sensitive details omitted'));
  }
  private defaults(ctx:Context):UserSettings {return {id:ctx.from!.id,displayName:ctx.from!.first_name,timezone:process.env.TIMEZONE??'America/Mexico_City',studyTime:'19:00',midweekDay:3,weekendDay:6};}
  private async reply(ctx:Context,text:string,id?:string,actions?:'active'|'complete') {
    const keyboard=new InlineKeyboard();
    if(id) keyboard.text('👍','fb:up:'+id).text('👎','fb:down:'+id).row();
    if(actions==='active') keyboard.text('🔎 Profundizar','act:deepening').text('🎯 Aplicar','act:application').row().text('✅ Terminar','act:finish');
    if(actions==='complete') keyboard.text('➡️ Seguir','act:continue').text('🔎 Profundizar','act:deepening').row().text('🎯 Aplicar','act:application').text('💬 Comentario','act:comment').row().text('💾 Guardar idea','act:save:'+(id??''));
    for(let i=0;i<text.length;i+=3500) {
      const last=i+3500>=text.length,hasKeyboard=last&&(Boolean(id)||Boolean(actions));
      await ctx.reply(text.slice(i,i+3500),hasKeyboard?{reply_markup:keyboard}:undefined);
    }
  }
  private async replyStudy(ctx:Context,result:{text:string;messageId?:string;completed?:boolean}) {await this.reply(ctx,result.text,result.messageId,result.messageId?(result.completed?'complete':'active'):undefined);}
  private register() {
    this.bot.command('start',ctx=>this.reply(ctx,'Hola. Soy tu compañero de estudio bíblico.\n\nUsa /hoy para iniciar una sesión guiada. Te haré una pregunta por turno durante varios pasos; responde con texto o audio y yo continuaré desde tu razonamiento. Usa /ayuda para ver todos los modos.'));
    this.bot.command('ayuda',ctx=>this.reply(ctx,'Cómo usar JW Ready:\n\n/hoy — sesión guiada de 5 pasos según tu próxima reunión\n/rapido — sesión de 3 pasos\n/profundizar — investigación guiada de 6 pasos\n/perla — profundizar en la lectura semanal\n/aplicar — convertir una idea en una acción personal\n/preparar — construir un comentario desde tus palabras\n/repaso — recordar y explicar lo estudiado\n\nDespués de iniciar, responde normalmente; no repitas el comando. Verás “Paso X de Y”. Puedes cambiar de modo con los botones o cerrar con /terminar.'));
    this.bot.command('configurar',async ctx=>{
      const user=await this.store.getUser(ctx.from!.id)??this.defaults(ctx);
      try { const updated=configure(user,ctx.match); await this.store.upsertUser(updated); await this.reply(ctx,'Estudio a las '+updated.studyTime+' ('+updated.timezone+'). Para cambiarlo: /configurar 19:00 3 6 America/Mexico_City. Días: 0 domingo, 1 lunes…6 sábado.'); }
      catch(e) {await this.reply(ctx,e instanceof Error?e.message:'Configuración inválida');}
    });
    for(const [command,kind] of Object.entries({hoy:'discovery',rapido:'discovery',profundizar:'deepening',perla:'deepening',preparar:'comment',repaso:'review',aplicar:'application'})) {
      this.bot.command(command,ctx=>this.start(ctx,kind as SessionKind,command));
    }
    this.bot.command('terminar',async ctx=>{const s=await this.store.getActiveSession(ctx.from!.id); if(s) await this.study.finish(s); await this.reply(ctx,s?'✅ Sesión terminada. Tus respuestas quedaron en la memoria semanal. Puedes usar /hoy para empezar otra.':'No hay una sesión activa.');});
    this.bot.command('comentarios',async ctx=>{const c=await this.store.listComments(ctx.from!.id); await this.reply(ctx,c.length?c.map(x=>x.text).join('\n\n'):'No hay comentarios. Usa /preparar.');});
    this.bot.command('guardar',async ctx=>{
      const s=await this.store.getLatestSession(ctx.from!.id), explicit=ctx.match.trim();
      const last=s?.messages.filter(m=>m.role==='assistant').at(-1);
      const trace=last?(await this.store.getMemories(ctx.from!.id)).find(m=>m.id===last.id&&m.kind==='trace'):undefined;
      const output=trace?JSON.parse(trace.text).output:undefined;
      const ids=output?.userMessageIds??[];
      if(!explicit&&(!last||!ids.length)) return this.reply(ctx,'Escribe /guardar seguido de tu idea, o termina de preparar un comentario basado en tus respuestas.');
      await this.store.saveComment(ctx.from!.id,explicit||last!.text,explicit?[]:ids,explicit?[]:last!.sourceIds);
      await this.reply(ctx,'💾 Guardado.');
    });
    this.bot.command('duda',async ctx=>{
      if(!ctx.match.trim()) return this.reply(ctx,'Usa /duda seguido de tu pregunta.');
      await this.store.saveMemory({id:newId('duda'),userId:ctx.from!.id,kind:'question',text:ctx.match.trim(),sourceMessageIds:[],saved:true,createdAt:new Date().toISOString()});
      await this.reply(ctx,'Duda guardada para investigar después.');
    });
    this.bot.command('fuentes',async ctx=>{
      const s=await this.store.getLatestSession(ctx.from!.id);
      const m=s?.snapshot?.material??(s?.weekId?await this.store.getMaterial(s.weekId):undefined);
      await this.reply(ctx,m?m.excerpts.slice(0,12).map(e=>e.url+(e.anchor??'')).join('\n'):'No hay fuentes disponibles.');
    });
    this.bot.command('exportar',async ctx=>{
      const data=await this.store.exportUserData(ctx.from!.id);
      await ctx.replyWithDocument(new InputFile(Buffer.from(JSON.stringify({...data,memories:await this.store.getMemories(ctx.from!.id)},null,2)),'jw-ready.json'));
    });
    this.bot.command('olvidar',async ctx=>{await this.store.deleteMemory(ctx.from!.id,ctx.match.trim()||undefined);await this.reply(ctx,'Recuerdos eliminados.');});
    this.bot.command('borrar_todo',async ctx=>{
      if(ctx.match.trim()!=='CONFIRMAR') return this.reply(ctx,'Para borrar tus datos: /borrar_todo CONFIRMAR');
      await this.store.deleteAllUserData(ctx.from!.id); await this.reply(ctx,'Datos eliminados. Usa /configurar para empezar de nuevo.');
    });
    this.bot.command('estado',async ctx=>{
      const s=await this.store.getActiveSession(ctx.from!.id);
      const owner=await this.store.getUser(ctx.from!.id);
      const progress=s?sessionProgress(s):undefined;
      await this.reply(ctx,'Bot activo. Sesión: '+(progress?`${progress.label} · paso ${progress.step} de ${progress.total}`:'ninguna')+'. Horario: '+(owner?.studyTime??'sin configurar'));
    });
    this.bot.command('feedback',async ctx=>{
      const [id,...correction]=ctx.match.trim().split(/\s+/);
      const found=(await this.store.listFeedback()).find(f=>f.id===id&&Number(f.userId)===ctx.from!.id);
      if(!found||!correction.length) return this.reply(ctx,'Usa /feedback ID seguido de tu corrección.');
      await this.store.addFeedback({...found,id:newId('feedback'),correction:correction.join(' '),createdAt:new Date().toISOString()});
      await this.reply(ctx,'Corrección guardada.');
    });
    this.bot.on('callback_query:data',async ctx=>{
      const [prefix,rating,id]=ctx.callbackQuery.data.split(':');
      if(prefix==='act') {
        await ctx.answerCallbackQuery('Preparando…');
        const active=await this.store.getActiveSession(ctx.from.id),latest=active??await this.store.getLatestSession(ctx.from.id);
        if(rating==='save') {
          const trace=(await this.store.getMemories(ctx.from.id)).find(m=>m.kind==='trace'&&m.id===id);
          if(!trace) return this.reply(ctx,'Esta idea ya no está disponible para guardar.');
          const payload=JSON.parse(trace.text),output=payload.output;
          await this.store.saveMemory({id:newId('saved'),userId:ctx.from.id,kind:'saved_note',text:output.message,sourceMessageIds:output.userMessageIds??[],saved:true,createdAt:new Date().toISOString()});
          return this.reply(ctx,'💾 Idea guardada en tu memoria personal.');
        }
        if(rating==='finish') {if(active)await this.study.finish(active);return this.reply(ctx,active?'✅ Sesión terminada.':'La sesión ya estaba terminada.');}
        if(!latest) return this.reply(ctx,'Usa /hoy para comenzar una sesión.');
        if(active) await this.study.finish(active);
        const kind:SessionKind=rating==='continue'?latest.kind:rating as SessionKind;
        if(!['discovery','deepening','application','comment','review'].includes(kind)) return this.reply(ctx,'Opción no disponible.');
        return this.start(ctx,kind,rating,latest.snapshot?.material);
      }
      if(prefix!=='fb'||!['up','down'].includes(rating)) return ctx.answerCallbackQuery('Feedback inválido');
      const trace=(await this.store.getMemories(ctx.from.id)).find(m=>m.kind==='trace'&&m.id===id);
      if(!trace) return ctx.answerCallbackQuery('Esta respuesta ya no está disponible');
      const payload=JSON.parse(trace.text);
      const existing=(await this.store.listFeedback(payload.nodeId)).find(f=>Number(f.userId)===ctx.from.id&&f.payload.messageId===id);
      if(existing) return ctx.answerCallbackQuery('Ya registraste esta respuesta');
      const feedbackId=newId('feedback');
      await this.store.addFeedback({id:feedbackId,userId:ctx.from.id,nodeId:payload.nodeId,nodeVersion:payload.nodeVersion,rating:rating as 'up'|'down',payload:{...payload,messageId:id},createdAt:new Date().toISOString()});
      await ctx.answerCallbackQuery('Guardado como caso de evaluación hasta que lo borres.');
      if(rating==='down') await this.reply(ctx,'Puedes añadir una corrección con /feedback '+feedbackId+' seguida de tu explicación.');
    });
    this.bot.on('message:text',ctx=>this.respond(ctx,ctx.message.text));
    this.bot.on('message:voice',async ctx=>{
      if(ctx.message.voice.duration>300 || (ctx.message.voice.file_size??0)>20*1024*1024) return this.reply(ctx,'Envía una nota de hasta 5 minutos y 20 MB.');
      const file=await ctx.getFile();
      const response=await fetch('https://api.telegram.org/file/bot'+this.bot.token+'/'+file.file_path,{signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw new Error('Audio download failed');
      const transcript=await this.llm.transcribe(Buffer.from(await response.arrayBuffer()));
      if(!transcript.trim()) return this.reply(ctx,'No pude entender el audio. Intenta otra nota o escribe tu respuesta.');
      await this.respond(ctx,transcript);
    });
  }
  private async respond(ctx:Context,text:string) {
    if(text.startsWith('/')) return this.reply(ctx,'Comando no reconocido. Prueba /hoy o /estado.');
    const s=await this.store.getActiveSession(ctx.from!.id);
    if(!s) return this.reply(ctx,'Usa /hoy para comenzar.');
    const material=s.weekId?await this.store.getMaterial(s.weekId):undefined;
    const result=await this.study.respond(s,text,material);
    await this.replyStudy(ctx,result);
  }
  private async start(ctx:Context,kind:SessionKind,command:string,materialOverride?:WeeklyMaterial) {
    const user=await this.store.getUser(ctx.from!.id)??this.defaults(ctx); await this.store.upsertUser(user);
    const plan=dailyPlan(user);
    if(command==='hoy'||command==='rapido') kind=plan.kind;
    const active=await this.store.getActiveSession(user.id);
    if(active&&['profundizar','preparar','repaso','aplicar','perla'].includes(command)) await this.study.finish(active);
    let material=materialOverride??await this.store.getMaterial(plan.week,plan.meeting);
    if(material&&kind==='deepening') material=await deepenMaterial(material);
    const result=await this.study.begin(user,kind,material,command==='rapido'?5:10);
    await this.replyStudy(ctx,result);
  }
  async sendScheduled(date=new Date()) {
    const user=this.allowedUserId?await this.store.getUser(this.allowedUserId):await this.store.getAnyUser();
    if(!user) return; this.allowedUserId=Number(user.id);
    const time=new Intl.DateTimeFormat('en-GB',{timeZone:user.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
    if(time!==user.studyTime || await this.store.getActiveSession(user.id)) return;
    const key='schedule:'+localDate(date,user.timezone);
    if((await this.store.getMemories(user.id)).some(m=>m.id===key)) return;
    const plan=dailyPlan(user,date),material=await this.store.getMaterial(plan.week,plan.meeting);
    const result=await this.study.begin(user,plan.kind,material);
    await this.bot.api.sendMessage(user.id,result.text.slice(0,3500));
    await this.store.saveMemory({id:key,userId:user.id,kind:'schedule',text:'sent',saved:false,sourceMessageIds:[],createdAt:date.toISOString(),expiresAt:new Date(date.getTime()+90*86400000).toISOString()});
  }
  async startPolling() { this.timer=setInterval(()=>{this.queue=this.queue.then(()=>this.sendScheduled()).catch(()=>console.error('Scheduled session failed'));},30000); await this.bot.start(); }
  async stop() {if(this.timer) clearInterval(this.timer);if(this.bot.isRunning()) await this.bot.stop();}
}
