import test from 'node:test';import assert from 'node:assert/strict';
import {discoverCurrentWeek} from '../src/planner.js';import {MemoryStore} from '../src/store.js';import {fetchText} from '../src/sources.js';
test('ingestion discovers both indexed documents including ISO year boundary',async()=>{
 const original=globalThis.fetch;const visited:string[]=[];
 globalThis.fetch=async(url:any)=>{visited.push(String(url));return new Response(String(url).includes('/meetings/')?'<h2>Vida y Ministerio</h2><a href="/es/wol/d/r4/lp-s/1">Week</a><h2>Estudio de La Atalaya</h2><a href="/es/wol/d/r4/lp-s/2">Study</a>':'<h1>Study</h1><div class="bodyTxt"><h3>Lesson</h3><p id="p1">Source text</p></div>');};
 try {const store=new MemoryStore();const result=await discoverCurrentWeek(store,new Date('2027-01-01T18:00:00Z'));assert.equal(result.length,2);assert.match(visited[0],/2026\/53/);assert.equal(store.materials.size,2);}
 finally{globalThis.fetch=original;}
});
test('redirect cannot escape official allowlist',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:302,headers:{location:'https://attacker.invalid'}});try{await assert.rejects(()=>fetchText('https://www.jw.org/es/test'));}finally{globalThis.fetch=original;}});
test('invalid scheme and malformed material URL fail safely',async()=>{await assert.rejects(()=>fetchText('file:///etc/passwd'));});
