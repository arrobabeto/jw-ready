import {LlmClient} from '../src/llm.js';
import type {NodeConfig,SourceExcerpt,WeeklyMaterial,UserSettings} from '../src/types.js';
export const user:UserSettings={id:901,displayName:'Test',timezone:'America/Mexico_City',studyTime:'19:00',midweekDay:3,weekendDay:6};
export const material:WeeklyMaterial={id:'midweek:2026-09-14',weekStart:'2026-09-14',weekEnd:'2026-09-20',meeting:'midweek',title:'Estudio',url:'https://www.jw.org/es/test',sections:[{title:'Lectura',text:'Obediencia',sourceIds:['s1']}],excerpts:[{id:'s1',url:'https://www.jw.org/es/test',anchor:'#p1',host:'www.jw.org',text:'Los recabitas obedecieron.'}],validated:true,hash:'fixture'};
export class FakeLlm extends LlmClient {
  calls:Array<{node:NodeConfig;input:Record<string,unknown>;sources:SourceExcerpt[]}>=[];
  malformed=false;reject=false;done=false;unknownSource=false;
  constructor(){super('');}
  override async run(node:NodeConfig,input:Record<string,unknown>,sources:SourceExcerpt[]=[]) {
    this.calls.push({node:structuredClone(node),input:structuredClone(input),sources});
    let json:Record<string,unknown>;
    if(node.id==='source_verifier') json=this.malformed?{}:{status:this.reject?'safe_fallback':'pass',reason:'verified'};
    else if(node.id==='memory_extractor') { const messages=input.messages as Array<{id:string;text:string}>;json={items:messages.map(m=>({text:m.text,sourceMessageIds:[m.id]}))}; }
    else {const messages=(input.conversation??[]) as Array<{id:string;role:string}>,closing=Boolean((input.sessionPlan as {mustFinish?:boolean}|undefined)?.mustFinish);json={message:closing?'La idea que construiste fue la obediencia constante.':'Tu observación sobre la obediencia nos permite avanzar.',nextQuestion:closing?'':'¿Qué aspecto te ayuda a profundizar en esa idea?',sourceIds:[this.unknownSource?'fake':sources[0]?.id??'s1'],userMessageIds:messages.filter(m=>m.role==='user').map(m=>m.id),done:closing};}
    return {text:JSON.stringify(json),json,model:node.model?.name??'fake'};
  }
  override async transcribe(){return 'Me llamó la atención la obediencia.';}
}
