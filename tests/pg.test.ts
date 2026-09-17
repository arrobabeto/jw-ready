import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {PgStore,newId} from '../src/store.js';import {StudyService} from '../src/study.js';import {loadNodes} from '../src/config.js';import {FakeLlm,user,material} from './helpers.js';
test('PostgreSQL lifecycle, restart mapping, retention, saved data and feedback',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname,'/jwready_test','Refusing destructive checks outside the isolated test database');
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});const st=new PgStore(pool);
 try{
 await st.upsertUser(user);assert.equal(typeof(await st.getAnyUser())!.id,'number');await st.saveMaterial(material);
 const service=new StudyService(st,loadNodes(),new FakeLlm());await service.begin(user,'discovery',material);
 const restored=await new PgStore(pool).getActiveSession(user.id);assert.equal(restored!.weekId,material.weekStart);assert.equal(restored!.userId,user.id);assert.equal(restored!.snapshot!.nodes.discovery_coach.version,'1.1.0');
 await service.respond(restored!,'Mi idea.');await service.finish(restored!);assert.equal(await st.getActiveSession(user.id),undefined);
 for(let i=0;i<101;i++)await st.saveMemory({id:'export-test-'+i,userId:user.id,kind:'weekly',text:'synthetic',saved:false,sourceMessageIds:[],expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString()});
 assert.ok((await st.getMemories(user.id)).length>100,'Exports and feedback lookup must not truncate at 100 records');
 await st.saveComment(user.id,'Persistente',[],[]);assert.equal((await st.listComments(user.id)).length,1);
 await st.addFeedback({id:newId('fb'),userId:user.id,nodeId:'discovery_coach',nodeVersion:'1.0.0',rating:'up',payload:{explicit:true},createdAt:new Date().toISOString()});
 await pool.query("UPDATE sessions SET started_at=now()-interval '91 days'");await pool.query("UPDATE memory_items SET expires_at=now()-interval '1 day' WHERE saved=false");
 await st.purgeExpired();assert.equal(await st.getLatestSession(user.id),undefined);assert.equal((await st.getMemories(user.id)).length,0);assert.equal((await st.listComments(user.id)).length,1);assert.equal((await st.listFeedback()).length,1);
 assert.ok((await st.exportUserData(user.id)).comments);
 await st.deleteAllUserData(user.id);assert.equal(await st.getAnyUser(),undefined);assert.equal((await st.listFeedback()).length,0);
 }finally{await pool.end();}
});
