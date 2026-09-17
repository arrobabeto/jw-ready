import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import yaml from 'js-yaml';
import {loadNodes} from '../src/config.js';import {MemoryStore} from '../src/store.js';import {validateCandidate,proposeImprovement,promoteNode,rollbackNode,runNode} from '../src/nodes.js';
import {acceptCandidate} from '../src/improvement.js';
import {FakeLlm,material} from './helpers.js';import type {NodeConfig,SourceExcerpt} from '../src/types.js';
test('candidate cannot weaken any protected field',()=>{
 const node=loadNodes().get('discovery_coach')!;
 for(const field of ['guardrails','allowed_tools','input_schema','output_schema','evaluation_suite','enabled','type']) {
  const candidate:any={...node,version:'1.0.1'};candidate[field]=field==='enabled'?false:field==='type'?'deterministic':[];
  assert.throws(()=>validateCandidate(node,yaml.dump(candidate)));
 }
});
test('optimizer replays cases; approved promotion and rollback',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jwready-nodes-'));
 try {
 fs.cpSync('nodes',dir,{recursive:true});const nodes=loadNodes(dir),node=nodes.get('discovery_coach')!,store=new MemoryStore();
 const candidateVersion='1.2.0';
 class Optimizer extends FakeLlm {override async run(n:NodeConfig,i:Record<string,unknown>,s:SourceExcerpt[]=[]) {
  if(n.id==='improvement_optimizer')return {text:'',model:'test',json:{yaml:yaml.dump({...node,version:candidateVersion,instructions:node.instructions+' Pregunta con más claridad.'})}};
  if(n.id==='candidate_evaluator')return {text:'',model:'test',json:{winner:'candidate',reason:'Clearer'}};
  return super.run(n,i,s);
 }}
 const llm=new Optimizer();assert.equal(await proposeImprovement(store,nodes,llm,node.id),undefined);
 for(let i=0;i<5;i++) await store.addFeedback({id:'f'+i,userId:1,nodeId:node.id,nodeVersion:node.version,rating:'down',payload:{input:{conversation:[]},sources:material.excerpts},createdAt:new Date().toISOString()});
 const c=(await proposeImprovement(store,nodes,llm,node.id))!;assert.equal(c.evaluation.recommended,true);assert.equal(c.status,'pending');
 assert.equal(loadNodes(dir).get(node.id)!.version,node.version);
 await acceptCandidate(store,c.id,dir);assert.equal(loadNodes(dir).get(node.id)!.version,candidateVersion);
 rollbackNode(node.id,dir);assert.equal(loadNodes(dir).get(node.id)!.version,node.version);
 assert.throws(()=>promoteNode(nodes,{...c,status:'pending',evaluation:{hardChecks:'fail'}},dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('deterministic and disabled nodes cannot invoke LLM',async()=>{const nodes=loadNodes();await assert.rejects(()=>runNode(nodes,new FakeLlm(),'weekly_planner',{}));nodes.get('discovery_coach')!.enabled=false;await assert.rejects(()=>runNode(nodes,new FakeLlm(),'discovery_coach',{}));});
