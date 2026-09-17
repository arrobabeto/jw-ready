import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, newId } from '../src/store.js';

test('MemoryStore conserva una sesión y sus mensajes', async () => {
  const store = new MemoryStore();
  const session = { id: newId('session'), userId: 1, kind: 'discovery' as const, status: 'active' as const, startedAt: new Date().toISOString(), nodeVersions: {}, messages: [] };
  await store.createSession(session);
  await store.appendMessage(session.id, { id: newId('msg'), role: 'assistant', text: '¿Qué observas?', sourceIds: ['s1'], createdAt: new Date().toISOString() });
  const active = await store.getActiveSession(1);
  assert.equal(active?.messages.length, 1);
});
test('expired memories disappear; saved questions and explicit feedback survive',async()=>{
 const s=new MemoryStore();const base={userId:1,kind:'weekly',text:'text',sourceMessageIds:[],createdAt:new Date().toISOString(),expiresAt:'2020-01-01T00:00:00Z'};
 await s.saveMemory({...base,id:'expired',saved:false});await s.saveMemory({...base,id:'saved',saved:true});
 await s.purgeExpired();assert.deepEqual((await s.getMemories(1)).map(m=>m.id),['saved']);await s.deleteMemory(1,'saved');assert.equal((await s.getMemories(1)).length,0);
});
