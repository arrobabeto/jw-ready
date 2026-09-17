import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('CLI validates, lists and rejects traversal',()=>{
 const run=(args:string[])=>execFileSync(process.execPath,['--import','tsx','src/cli.ts',...args],{env:{...process.env,STORE_MODE:'memory'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.match(run(['nodes','validate']),/válidos/);assert.match(run(['nodes','list']),/discovery_coach/);
 assert.match(run(['nodes','show','discovery_coach']),/instructions/);assert.throws(()=>run(['nodes','show','../.env']));
});
