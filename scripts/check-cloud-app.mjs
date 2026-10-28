import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function checkCloudApp({baseUrl,requestOrigin,createBackup=true}){
 const base=new URL(baseUrl),origin=requestOrigin||base.origin;
 assert.ok(base.protocol==='https:'||base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Use HTTPS or a localhost test server.');
 const report={at:new Date().toISOString(),url:base.origin,mode:'Cloud API check; browser rendering is not covered.',accounts:[]};
 const request=(route,{cookie,data,method=data===undefined?'GET':'POST',...options}={})=>fetch(new URL(route,base),{...options,method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...options.headers},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(45000)});
 const json=async(route,options={})=>{const r=await request(route,options);assert.equal(r.status,200,route+' HTTP '+r.status);return r.json();};
 const health=await json('/api/health');assert.equal(health.database,'PostgreSQL');assert.equal(health.storage,'private-cloud');assert.equal(health.project,undefined);assert.equal(health.dataDirectory,undefined);
 assert.equal((await request('/')).status,200);assert.equal((await request('/uploads.js')).status,200);
 assert.equal((await request('/api/cases')).status,401);assert.equal((await request('/api/cron')).status,403);
 const {accounts}=await json('/api/auth/demo');assert.equal(accounts.length,6);let originalIds;
 for(const a of accounts){
  const login=await request('/api/auth/login',{data:{email:a.email,password:a.password}});assert.equal(login.status,200,a.id+' login');const raw=login.headers.get('set-cookie');assert.match(raw,/Secure/);assert.match(raw,/HttpOnly/);const cookie=raw.split(';')[0];
  try{
   const me=await json('/api/auth/me',{cookie});assert.equal(me.user.id,a.id);assert.equal(me.user.passwordHash,undefined);
   const cases=await json('/api/cases',{cookie}),staff=a.role!=='Complainant';
   assert.equal((await request('/api/innovation',{cookie})).status,staff?200:403);
   assert.equal((await request('/api/admin/access',{cookie})).status,a.role==='Admin'?200:403);
   if(!staff){assert.ok(cases.cases.every(c=>c.ownerId===a.id));for(const c of cases.cases)for(const key of ['notes','tasks','officialActions','dependencies','evidenceRefs','closureProof'])assert.equal(c[key],undefined,a.id+' private '+key);}
   if(a.role==='Admin'){
    originalIds=cases.cases.map(c=>c.id).sort();report.casesBefore=originalIds.length;
    const institutions=await json('/api/institutions',{cookie});report.institutions=institutions.institutions.length;
    const directory=await json('/api/admin/access',{cookie});assert.equal(directory.accounts.find(u=>u.id==='admin').name,'Sakshi Sharma');assert.equal(directory.accounts.find(u=>u.id==='regional').name,'Nidhi Singh');
    const c=cases.cases.find(c=>c.attachments?.length),attachment=c?.attachments[0];
    if(attachment){const download=await request(`/api/cases/${c.id}/attachments/${attachment.id}`,{cookie});assert.equal(download.status,302);const target=new URL(download.headers.get('location'));assert.equal(target.origin,new URL(process.env.SUPABASE_URL).origin);const r=await fetch(target,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),attachment.sha256);report.migratedEvidence='digest verified';}
    if(createBackup){const made=await request('/api/backups',{cookie,data:{}});assert.equal(made.status,201);const {id}=await made.json();const download=await request('/api/backups/'+id,{cookie});assert.equal(download.status,302);const target=new URL(download.headers.get('location'));assert.equal(target.origin,new URL(process.env.SUPABASE_URL).origin);const r=await fetch(target,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const snapshot=JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())));assert.deepEqual(snapshot.state.cases.map(c=>c.id).sort(),originalIds);assert.ok(snapshot.users.every(u=>u.passwordHash&&!u.password));assert.equal(snapshot.sessionsIncluded,false);report.cloudBackup='created and verified';}
   }
   if(cases.cases.length){const proof=await json('/api/cases/'+cases.cases[0].id+'/safeguards',{cookie});assert.equal(proof.requirements.length,3);}
   report.accounts.push({id:a.id,login:'pass',visibleCases:cases.cases.length,authority:'pass',privacy:'pass'});
   console.log(a.id+': cloud login, case access and privacy checks passed.');
  }finally{await request('/api/auth/logout',{cookie,data:{}});assert.equal((await request('/api/auth/me',{cookie})).status,401);}
 }
 const admin=accounts.find(a=>a.id==='admin'),login=await request('/api/auth/login',{data:{email:admin.email,password:admin.password}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 try{const after=await json('/api/cases',{cookie});assert.deepEqual(after.cases.map(c=>c.id).sort(),originalIds);report.casesAfter=after.cases.length;}finally{await request('/api/auth/logout',{cookie,data:{}});}
 report.result='pass';return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const report=await checkCloudApp({baseUrl:process.env.SAMANVAY_URL||process.env.SAMANVAY_PUBLIC_URL,createBackup:process.env.SAMANVAY_CHECK_BACKUP!=='false'});await mkdir(new URL('../qa-artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../qa-artifacts/cloud-app-live-check.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
 catch(e){console.error('Cloud app check failed: '+e.message);process.exitCode=1;}
}
