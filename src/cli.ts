import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { loadNodes } from './config.js';
import { MemoryStore } from './store.js';
import pg from 'pg';
import { PgStore } from './store.js';
import { acceptCandidate, runImprovement } from './improvement.js';
import {rollbackNode} from './nodes.js';

const [, , group, command, arg] = process.argv;
const configDir = process.env.NODE_CONFIG_DIR ?? 'nodes';
const pool=process.env.STORE_MODE!=='memory'&&process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL}):undefined;
const store=pool?new PgStore(pool):new MemoryStore();

async function main() {
  if(arg && ['show','rollback'].includes(command) && !/^[a-z0-9_]+$/.test(arg)) throw new Error('Invalid node id');
  if(group==='nodes'&&command==='rollback'&&arg) {rollbackNode(arg,configDir);console.log('Rollback completado');return;}
  if(group==='nodes'&&command==='test') {loadNodes(configDir);const {execFileSync}=await import('node:child_process');execFileSync('npm',['test'],{stdio:'inherit'});return;}
  if(group==='improve'&&command==='review') {const c=(await store.listCandidates()).find(c=>c.id===arg);if(!c)throw new Error('Candidate not found');console.log(JSON.stringify(c,null,2));return;}
  if(group==='improve'&&command==='reject') {await store.updateCandidateStatus(arg,'rejected');console.log('Rechazado');return;}
  if(group==='feedback'&&command==='list') {console.log(JSON.stringify(await store.listFeedback(arg),null,2));return;}
  if (group === 'nodes' && command === 'validate') { const nodes = loadNodes(configDir); console.log(`OK: ${nodes.size} nodos válidos`); return; }
  if (group === 'nodes' && command === 'list') { for (const n of loadNodes(configDir).values()) console.log(`${n.id}@${n.version}\t${n.model?.name ?? 'deterministic'}`); return; }
  if (group === 'nodes' && command === 'show') { console.log(fs.readFileSync(path.join(configDir, `${arg}.yaml`), 'utf8')); return; }
  if (group === 'improve' && command === 'run' && arg) { console.log(JSON.stringify(await runImprovement(store, arg), null, 2)); return; }
  if (group === 'improve' && command === 'accept' && arg) { console.log(`Backup creado: ${await acceptCandidate(store, arg)}`); return; }
  console.log('Uso: nodes validate|list|show <id> | improve run <node> | improve accept <candidate>');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(()=>pool?.end());
