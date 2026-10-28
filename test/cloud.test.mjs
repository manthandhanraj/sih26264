import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {cloudConfig,createCloudBackend,openCloudStore} from '../src/cloud-store.mjs';
import {createServerlessHandler} from '../api/index.mjs';
import {DEMO_ACCOUNTS} from '../src/auth.mjs';
import {seedCases} from '../src/domain.mjs';
import {openStore} from '../src/store.mjs';
import {migrateToSupabase} from '../scripts/migrate-to-supabase.mjs';
import {RequestError} from '../src/validation.mjs';

test('cloud configuration fails closed without secrets or HTTPS',()=>{
 assert.throws(()=>cloudConfig({}),/incomplete/);
 assert.throws(()=>cloudConfig({SUPABASE_URL:'http://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',SAMANVAY_PUBLIC_URL:'https://demo.example.test'}),/HTTPS/);
 assert.throws(()=>cloudConfig({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',SAMANVAY_PUBLIC_URL:'https://demo.example.test/path'}),/origin only/);
 const configured=cloudConfig({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',SAMANVAY_PUBLIC_URL:'https://demo.example.test',VERCEL_URL:'owned-deployment.vercel.app',VERCEL_BRANCH_URL:'owned-branch.vercel.app'});
 assert.ok(configured.origins.includes('https://owned-deployment.vercel.app'));assert.ok(!configured.origins.includes('https://unrelated.vercel.app'));
});

test('official Supabase client sends credentials only in server headers and produces signed private URLs',async()=>{
 const seen=[],config={url:'https://storage.samanvay.test',key:'test-only-service-key',bucket:'samanvay-private'};
 const backend=createCloudBackend(config,{fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname;seen.push({path,headers:new Headers(options.headers),body:options.body});
  let body=path.includes('/rest/v1/rpc/')?null:path.includes('/bucket/')?{public:false,file_size_limit:5242880}:path.includes('/object/upload/sign/')?{url:'/object/upload/sign/samanvay-private/pending/test?token=temporary-upload-token'}:path.includes('/object/sign/')?{signedURL:'/object/sign/samanvay-private/evidence/test.txt?token=temporary-download-token'}:{};
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 await backend.rpc('samanvay_open');await backend.checkBucket();
 const upload=await backend.signUpload('pending/test'),download=await backend.signDownload('evidence/test.txt','test.txt');
 assert.match(upload.signedUrl,/temporary-upload-token/);assert.match(download,/temporary-download-token/);assert.ok(!upload.signedUrl.includes(config.key)&&!download.includes(config.key));
 assert.ok(seen.every(r=>r.headers.get('apikey')===config.key));assert.equal(JSON.parse(seen.find(r=>r.path.includes('/object/sign/')).body).expiresIn,60);
});

test('serverless PostgreSQL persistence, private evidence, concurrent writes and cold requests',async t=>{
 const db=new PGlite(),objects=new Map();let loseNextSaveConfirmation=false;
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const config={url:'https://storage.samanvay.test',key:'test-only-service-key',origin:'https://demo.samanvay.test',origins:['https://demo.samanvay.test','https://owned-deployment.vercel.app'],bucket:'samanvay-private'};
 const backend={config,
  async rpc(name,args={}){
   assert.match(name,/^samanvay_[a-z_]+$/);const entries=Object.entries(args);for(const [key]of entries)assert.match(key,/^p_[a-z_]+$/);
   const result=await db.transaction(async tx=>{await tx.exec('set local role service_role');const query='select public.'+name+'('+entries.map(([key],i)=>key+'=> $'+(i+1)).join(',')+') as result';const values=entries.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v);return (await tx.query(query,values)).rows[0].result;});
   if(name==='samanvay_save'&&loseNextSaveConfirmation){loseNextSaveConfirmation=false;throw new RequestError('Simulated lost network confirmation',503);}return result;
  },
  async read(key){assert.ok(objects.has(key),'Missing private object: '+key);return Buffer.from(objects.get(key));},
  async write(key,bytes){assert.ok(!objects.has(key),'Immutable object already exists');objects.set(key,Buffer.from(bytes));},
  async remove(key){objects.delete(key);},async copy(source,target){assert.ok(objects.has(source));assert.ok(!objects.has(target));objects.set(target,Buffer.from(objects.get(source)));},
  async signUpload(key){return {signedUrl:config.url+'/object/upload/'+key+'?token=test-upload'};},
  async signDownload(key,name){assert.ok(objects.has(key));return config.url+'/object/sign/'+key+'?download='+encodeURIComponent(name)+'&token=test-short-lived';},
  async cleanPending(){},
 };
 const handler=createServerlessHandler({getBackend:()=>backend,getOrigin:()=>config.origin,getCronSecret:()=>'test-only-cron-secret'});
 const server=http.createServer(async(req,res)=>{
  // Vercel may supply a pre-parsed body. Exercise that path, not only streams.
  if(req.headers['content-type']==='application/json'){const chunks=[];for await(const chunk of req)chunks.push(chunk);try{req.body=JSON.parse(Buffer.concat(chunks));}catch{req.body='invalid JSON';}}
  await handler(req,res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,cookies={};
 const req=async(id,route,data,method=data===undefined?'GET':'POST',extra={})=>{
  const r=await fetch(base+route,{method,redirect:'manual',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(id?{Cookie:cookies[id]}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const content=r.headers.get('content-type')||'';return {status:r.status,headers:r.headers,data:content.includes('application/json')?await r.json():await r.text()};
 };
 let newCase,passportId;
 try{
  await t.test('anonymous database and RPC access are denied; the bucket stays private',async()=>{
   await db.exec('set role anon');try{await assert.rejects(db.query('select * from public.samanvay_state'),/permission denied/);await assert.rejects(db.query('select public.samanvay_open()'),/permission denied/);}finally{await db.exec('reset role');}
   const bucket=(await db.query('select * from storage.buckets')).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5*1024*1024);
  });
  await t.test('static page works without cloud initialization and private routes remain protected',async()=>{
   assert.equal((await req(null,'/')).status,200);assert.equal((await req(null,'/uploads.js')).status,200);
   assert.equal((await req(null,'/api/cases')).status,401);
   const health=await req(null,'/api/health');assert.equal(health.data.database,'PostgreSQL');assert.equal(health.data.project,undefined);assert.equal(health.data.dataDirectory,undefined);
   assert.equal((await req(null,'/data/samanvay.sqlite')).status,404);
  });
  await t.test('all six accounts authenticate across independent function instances with Secure cookies',async()=>{
   for(const a of DEMO_ACCOUNTS){const r=await req(null,'/api/auth/login',{email:a.email,password:a.password},'POST',{Origin:config.origin});assert.equal(r.status,200,JSON.stringify(r.data));cookies[a.id]=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/Secure/);const me=await req(a.id,'/api/auth/me');assert.equal(me.data.user.id,a.id);assert.equal(me.data.user.passwordHash,undefined);}
   assert.equal((await req('student','/api/backups')).status,403);assert.equal((await req('student','/api/innovation')).status,403);
   const own=await req('faculty','/api/cases');assert.ok(own.data.cases.every(c=>c.ownerId==='faculty'&&c.notes===undefined));
  });
  await t.test('HTTPS same-origin writes succeed and forged origins fail',async()=>{
   const admin=DEMO_ACCOUNTS.find(a=>a.id==='admin');assert.equal((await req(null,'/api/auth/login',{email:admin.email,password:admin.password},'POST',{Origin:'https://owned-deployment.vercel.app'})).status,200);
   assert.equal((await req('admin','/api/cases',{},'POST',{Origin:'https://unrelated.vercel.app'})).status,403);
   assert.equal((await req('admin','/api/cases',{},'POST',{Origin:'https://attacker.example.test','X-Forwarded-Proto':'https'})).status,403);
   const r=await req('student','/api/cases',{title:'Cloud refund follow-up',description:'A synthetic refund follow-up used to verify durable cloud storage.',institution:'Cloud Demo Institute',institutionId:'1-CLOUD-DEMO',category:'Fee refund',bureau:'PGRC',priority:'Medium',region:'North'},'POST',{Origin:config.origin});assert.equal(r.status,201,JSON.stringify(r.data));newCase=r.data;
   assert.ok((await req('student','/api/cases')).data.cases.some(c=>c.id===newCase.id));
  });
  await t.test('two stale snapshots cannot silently overwrite each other',async()=>{
   const a=await openCloudStore(backend,seedCases()),b=await openCloudStore(backend,seedCases()),one=a.read(),two=b.read();one.settings.remindBeforeDays=3;two.settings.remindBeforeDays=4;await a.save(one);await assert.rejects(b.save(two),e=>e.status===409);assert.equal((await b.reload()).settings.remindBeforeDays,3);
   assert.equal((await openCloudStore(backend,[])).read().cases.length,13,'New instances must not reset or reseed saved cases');
  });
  await t.test('a full 5 MB evidence file uses a short ticket and downloads only through a signed URL',async()=>{
   const signed=await req('student','/api/uploads/sign',{caseId:newCase.id,name:'cloud-evidence.txt',type:'text/plain',size:5*1024*1024});assert.equal(signed.status,200,JSON.stringify(signed.data));assert.ok(signed.data.uploadTicket.length<2000);
   const claim=JSON.parse(Buffer.from(signed.data.uploadTicket.split('.')[0],'base64url'));objects.set(claim.pending,Buffer.alloc(5*1024*1024,65));
   assert.equal((await req('faculty',`/api/cases/${newCase.id}/attachments`,{uploadTicket:signed.data.uploadTicket})).status,403);
   const saved=await req('student',`/api/cases/${newCase.id}/attachments`,{uploadTicket:signed.data.uploadTicket});assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(objects.has(claim.pending),false);
   const download=await req('student',`/api/cases/${newCase.id}/attachments/${saved.data.id}`);assert.equal(download.status,302);assert.match(download.headers.get('location'),/object\/sign/);
   assert.equal((await req('faculty',`/api/cases/${newCase.id}/attachments/${saved.data.id}`)).status,403);
   const signedAgain=await req('student','/api/uploads/sign',{caseId:newCase.id,name:'tamper.txt',type:'text/plain',size:3});
   assert.equal((await req('student',`/api/cases/${newCase.id}/attachments`,{uploadTicket:signedAgain.data.uploadTicket+'x'})).status,403);
  });
  await t.test('evidence integrity is rechecked after the file has been saved',async()=>{
   const store=await openCloudStore(backend,[]),a=store.read().cases.find(c=>c.id===newCase.id).attachments[0],key='evidence/'+a.stored,original=objects.get(key);objects.set(key,Buffer.from('tampered'));
   const r=await req('admin',`/api/cases/${newCase.id}/attachments/${a.id}`);assert.equal(r.status,409);objects.set(key,original);
  });
  await t.test('CSV previews survive cold requests; commits are atomic and retries do not duplicate institutions',async()=>{
   const csv='AICTE Permanent ID,Institution Name,Region\n1-CLOUD-IMPORT,Cloud Import Demo Institute,North\n';
   let r=await req('admin','/api/institution-imports/preview',{fileName:'cloud.csv',content:Buffer.from(csv).toString('base64')});assert.equal(r.status,200,JSON.stringify(r.data));let preview=r.data;
   r=await req('admin','/api/institution-imports/preview',{previewId:preview.id,mapping:preview.mapping,defaultRegion:'North'});assert.equal(r.status,200);preview=r.data;
   const committed=await req('admin',`/api/institution-imports/${preview.id}/commit`,{revision:preview.revision});assert.equal(committed.status,201,JSON.stringify(committed.data));
   const replay=await req('admin',`/api/institution-imports/${preview.id}/commit`,{revision:preview.revision});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
   assert.equal((await req('admin','/api/institutions')).data.institutions.filter(i=>i.id==='1-CLOUD-IMPORT').length,1);
  });
  await t.test('a changed preview revision blocks its pending database commit',async()=>{
   const store=await openCloudStore(backend,[]),state=store.read(),id='test-draft-cas',job={id,userId:'admin',revision:1,expiresAt:Date.now()+10000};
   await store.drafts.put(job,0);await store.drafts.put({...job,revision:2},1);
   await assert.rejects(store.save(state,{draft:{id,revision:1,userId:'admin'}}),e=>e.status===409);
  });
  await t.test('private backups contain a restorable snapshot, hashed users and copied evidence',async()=>{
   const r=await req('admin','/api/backups',{});assert.equal(r.status,201,JSON.stringify(r.data));
   const manifest=await backend.rpc('samanvay_backup',{p_id:r.data.id});assert.equal(manifest.format,'cloud-json-gzip');
   const snapshot=JSON.parse(gunzipSync(objects.get(manifest.object)));assert.equal(snapshot.state.cases.length,13);assert.ok(snapshot.users.every(u=>u.passwordHash&&!u.password));assert.equal(snapshot.sessionsIncluded,false);
   assert.equal(snapshot.files.length,1);assert.ok(objects.has(snapshot.files[0].key));
   assert.equal((await req('admin','/api/backups/'+r.data.id)).status,302);
  });
  await t.test('a lost save confirmation never deletes evidence that PostgreSQL already references',async()=>{
   const signed=await req('student','/api/uploads/sign',{caseId:newCase.id,name:'uncertain.txt',type:'text/plain',size:2});
   const claim=JSON.parse(Buffer.from(signed.data.uploadTicket.split('.')[0],'base64url'));objects.set(claim.pending,Buffer.from('OK'));loseNextSaveConfirmation=true;
   const result=await req('student',`/api/cases/${newCase.id}/attachments`,{uploadTicket:signed.data.uploadTicket});assert.equal(result.status,503);
   const saved=(await openCloudStore(backend,[])).read().cases.find(c=>c.id===newCase.id).attachments.find(a=>a.name==='uncertain.txt');assert.ok(saved);assert.ok(objects.has('evidence/'+saved.stored));
   assert.equal((await req('student',`/api/cases/${newCase.id}/attachments/${saved.id}`)).status,302);
  });
  await t.test('login limits and logout survive separate function invocations',async()=>{
   for(let n=0;n<8;n++)assert.equal((await req(null,'/api/auth/login',{email:'no-user@samanvay.demo',password:'incorrect'})).status,401);
   assert.equal((await req(null,'/api/auth/login',{email:'no-user@samanvay.demo',password:'incorrect'})).status,429);
   assert.equal((await req('faculty','/api/auth/logout',{})).status,200);assert.equal((await req('faculty','/api/auth/me')).status,401);
  });
  await t.test('serverless updates use polling and scheduled maintenance needs its secret',async()=>{
   assert.equal((await req('admin','/api/events')).status,204);assert.equal((await req(null,'/api/cron')).status,403);
   const r=await req(null,'/api/cron',undefined,'GET',{Authorization:'Bearer test-only-cron-secret'});assert.equal(r.status,200,JSON.stringify(r.data));
   assert.equal(r.data.backupId,null,'A daily backup already exists');
  });
  await t.test('migration preserves local SQLite and evidence and refuses to overwrite initialized cloud data',async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-cloud-migration-'));
   try{
    const local=await openStore(dir,seedCases()),state=local.read(),bytes=Buffer.from('Synthetic migration evidence.'),stored='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.txt';
    state.cases[0].attachments=[{id:'file-migration',stored,name:'source.txt',type:'text/plain',sha256:createHash('sha256').update(bytes).digest('hex')}];
    local.save(state);local.close();await mkdir(path.join(dir,'attachments'));await writeFile(path.join(dir,'attachments',stored),bytes);
    const original=await readFile(path.join(dir,'samanvay.sqlite'));
    await assert.rejects(migrateToSupabase({backend,dataDirectory:dir}),/already initialized/);
    // This is the in-memory test database, never workspace or cloud data.
    await db.query('delete from public.samanvay_state');
    const migrated=await migrateToSupabase({backend,dataDirectory:dir});assert.equal(migrated.cases,12);assert.equal(migrated.accounts,6);assert.equal(migrated.evidenceFiles,1);
    assert.ok((await readFile(path.join(dir,'samanvay.sqlite'))).equals(original));assert.ok((await readFile(path.join(dir,'attachments',stored))).equals(bytes));
    const fresh=await openCloudStore(backend,[]),a=fresh.read().cases.find(c=>c.attachments.length).attachments[0];assert.notEqual(a.stored,stored);assert.ok((await backend.read('evidence/'+a.stored)).equals(bytes));
    await assert.rejects(migrateToSupabase({backend,dataDirectory:dir}),/already initialized/);
   }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('samanvay-cloud-migration-'));await rm(dir,{recursive:true,force:true});}
  });
 }finally{await new Promise(resolve=>server.close(resolve));await db.close();}
});
