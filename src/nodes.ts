import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadNodes, nodeSchema } from './config.js';
import {coachOutput,verifierOutput} from './contracts.js';
import type { Candidate, NodeConfig, SourceExcerpt, StudySession } from './types.js';
import { LlmClient } from './llm.js';
import { newId, type Store } from './store.js';

export function nodeVersions(nodes: Map<string, NodeConfig>) { return Object.fromEntries([...nodes].map(([id, n]) => [id, n.version])); }

export async function runNode(nodes: Map<string, NodeConfig>, llm: LlmClient, id: string, input: Record<string, unknown>, sources: SourceExcerpt[] = [], runtimeInstructions = '') {
  const node = nodes.get(id); if (!node || !node.enabled) throw new Error(`Node disabled or missing: ${id}`);
  if(node.type!=='llm') throw new Error('Deterministic nodes must run through their implementation');
  return llm.run(node, input, sources, runtimeInstructions);
}

export async function proposeImprovement(store: Store, nodes: Map<string, NodeConfig>, llm: LlmClient, nodeId: string): Promise<Candidate | undefined> {
  const node = nodes.get(nodeId); if (!node) throw new Error(`Unknown node: ${nodeId}`);
  const cases = await store.listFeedback(nodeId); if (cases.length < 5) return undefined;
  const result = await runNode(nodes, llm, 'improvement_optimizer', { targetNode: node, cases: cases.slice(-50) });
  const yamlText = typeof result.json?.yaml === 'string' ? result.json.yaml : '';
  if (!yamlText) return undefined;
  const candidate = validateCandidate(node,yamlText);
  const selected=cases.filter(c=>c.payload.input&&Array.isArray(c.payload.sources)).slice(-20);
  if(selected.length<5) throw new Error('Need five replayable cases with input and sources');
  let wins=0,regressions=0;const comparisons=[];
  for(const c of selected) {
    const sources=c.payload.sources as SourceExcerpt[],input=c.payload.input as Record<string,unknown>;
    try {
      const incumbent=await llm.run(node,input,sources),proposed=await llm.run(candidate,input,sources);
      const parsed=coachOutput.parse(proposed.json);
      if(parsed.sourceIds.some(id=>!sources.some(s=>s.id===id))) throw new Error('Unknown citation');
      const conversation=(input.conversation??[]) as Array<{id:string;role:string}>;
      if(parsed.userMessageIds.some(id=>!conversation.some(m=>m.id===id&&m.role==='user'))) throw new Error('Unknown user provenance');
      if(nodeId==='comment_composer'&&parsed.done&&!parsed.userMessageIds.length) throw new Error('Missing user provenance');
      const verified=verifierOutput.parse((await runNode(nodes,llm,'source_verifier',{response:parsed.message+'\n'+parsed.nextQuestion,sourceIds:parsed.sourceIds,conversation:input.conversation},sources)).json);
      if(verified.status!=='pass') throw new Error('Unsupported answer');
      const judgment=await runNode(nodes,llm,'candidate_evaluator',{incumbent:incumbent.json,candidate:proposed.json,feedback:c.rating,correction:c.correction},sources);
      if(judgment.json?.winner==='candidate') wins++;
      else if(judgment.json?.winner!=='tie') regressions++;
      comparisons.push({caseId:c.id,incumbent:incumbent.json,candidate:proposed.json,judgment:judgment.json});
    } catch {regressions++;comparisons.push({caseId:c.id,error:'Candidate failed schema/source validation'});}
  }
  const evaluation={cases:selected.length,wins,regressions,preferenceDelta:wins/selected.length,hardChecks:regressions===0?'pass':'fail',recommended:regressions===0&&wins/selected.length>=0.1,comparisons};
  const c: Candidate = { id: newId('candidate'), nodeId, baseVersion: node.version, candidateVersion: candidate.version, yaml: yamlText, evaluation, status: 'pending' };
  await store.saveCandidate(c); return c;
}

export function promoteNode(nodes: Map<string, NodeConfig>, candidate: Candidate, configDir = process.env.NODE_CONFIG_DIR ?? 'nodes') {
  const current = nodes.get(candidate.nodeId); if (!current || current.version !== candidate.baseVersion) throw new Error('Base node changed; rebase candidate first');
  if(candidate.status!=='pending'||candidate.evaluation.hardChecks!=='pass'||candidate.evaluation.recommended!==true) throw new Error('Candidate has not passed evaluation');
  validateCandidate(current,candidate.yaml);
  const file = path.join(configDir, `${candidate.nodeId}.yaml`);
  const backup = `${file}.bak-${current.version}`;
  fs.copyFileSync(file, backup,fs.constants.COPYFILE_EXCL);
  const temporary=file+'.pending';fs.writeFileSync(temporary,candidate.yaml,'utf8');fs.renameSync(temporary,file);
  return backup;
}

export function reloadNodes(configDir = process.env.NODE_CONFIG_DIR ?? 'nodes') { return loadNodes(configDir); }
export function validateCandidate(node:NodeConfig,text:string):NodeConfig {
  const candidate=nodeSchema.parse(yaml.load(text));
  if(candidate.id!==node.id||candidate.version===node.version) throw new Error('Candidate must preserve id and change version');
  for(const field of ['type','enabled','guardrails','allowed_tools','input_schema','output_schema','evaluation_suite'] as const) {
    if(JSON.stringify(candidate[field])!==JSON.stringify(node[field])) throw new Error('Protected field changed: '+field);
  }
  return candidate;
}
export function rollbackNode(id:string,configDir=process.env.NODE_CONFIG_DIR??'nodes') {
  if(!/^[a-z0-9_]+$/.test(id)) throw new Error('Invalid node id');
  const file=path.join(configDir,id+'.yaml');
  const backups=fs.readdirSync(configDir).filter(f=>f.startsWith(id+'.yaml.bak-')).sort((a,b)=>fs.statSync(path.join(configDir,b)).mtimeMs-fs.statSync(path.join(configDir,a)).mtimeMs);
  if(!backups.length) throw new Error('No backup exists');
  const text=fs.readFileSync(path.join(configDir,backups[0]),'utf8');nodeSchema.parse(yaml.load(text));
  fs.writeFileSync(file+'.pending',text);fs.renameSync(file+'.pending',file);
}
