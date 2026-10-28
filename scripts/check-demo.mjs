import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// This checks the running local demo. It creates and closes temporary login
// sessions, and never creates complaints, actions, evidence or policy runs.
const base=new URL(process.env.SAMANVAY_URL||'http://127.0.0.1:3000');
assert.ok(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Use a local Samanvay URL.');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const report={at:new Date().toISOString(),url:base.origin,accounts:[],checks:[],visualReview:'Not performed by this API check.'};
const request=(route,options={})=>fetch(new URL(route,base),{...options,signal:AbortSignal.timeout(15000)});
const json=async(route,options)=>{const r=await request(route,options);assert.equal(r.status,200,`${route}: expected 200, received ${r.status}`);return r.json();};
const post=(data,cookie)=>({method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});

try{
 const health=await json('/api/health');assert.equal(health.app,'samanvay');
 const page=await(await request('/')).text();assert.match(page,/data-view="innovation"/);assert.match(page,/data-design="sandstone"/);
 const client=await(await request('/safeguards.js')).text();
 for(const name of ['Action Collision Guard','Deadlock Radar','Evidence Passport','Resolution Proof Check','Policy Sandbox'])assert.ok(client.toLowerCase().includes(name.toLowerCase()),`${name} client missing`);
 report.checks.push('Local health, selected theme, navigation and five safeguard screens served.');
 assert.equal((await request('/api/cases')).status,401);assert.equal((await request('/api/innovation')).status,401);
 const {accounts}=await json('/api/auth/demo');assert.deepEqual(accounts.map(a=>a.id).sort(),['admin','faculty','pgrc','regional','regulation','student']);
 let adminBefore,adminAfter;
 for(const a of accounts){
  const login=await request('/api/auth/login',post({email:a.email,password:a.password}));assert.equal(login.status,200,`${a.id} login`);
  const cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie};
  try{
   const me=await json('/api/auth/me',{headers});assert.equal(me.user.id,a.id);assert.equal(me.user.passwordHash,undefined);
   const data=await json('/api/cases',{headers}),staff=a.role!=='Complainant';
   assert.equal((await request('/api/innovation',{headers})).status,staff?200:403);
   assert.equal((await request('/api/admin/access',{headers})).status,a.role==='Admin'?200:403);
   if(a.role==='Admin'){
    adminBefore=data.cases.length;
    const directory=await json('/api/admin/access',{headers});assert.equal(directory.accounts.length,6);
    assert.equal(directory.accounts.find(u=>u.id==='admin').name,'Sakshi Sharma');assert.equal(directory.accounts.find(u=>u.id==='regional').name,'Nidhi Singh');
   }
   if(!staff){
    assert.ok(data.cases.every(c=>c.ownerId===a.id));assert.equal(data.related.length,0);
    for(const c of data.cases)for(const key of ['notes','tasks','officialActions','dependencies','evidenceRefs','closureProof','objections'])assert.equal(c[key],undefined,`${a.id} must not receive internal ${key}`);
   }
   if(data.cases.length){
    const safeguards=await json(`/api/cases/${data.cases[0].id}/safeguards`,{headers});assert.equal(safeguards.requirements.length,3);
    if(staff){assert.ok(Array.isArray(safeguards.actions));assert.ok(Array.isArray(safeguards.passports));}
    else for(const key of ['actions','dependencies','passports','targets'])assert.equal(safeguards[key],undefined);
   }
   report.accounts.push({id:a.id,role:a.role,visibleCases:data.cases.length,login:'pass',safeguards:data.cases.length?'pass':'no cases available',labAccess:staff?'allowed':'denied',adminAccess:a.role==='Admin'?'allowed':'denied'});
   console.log(`${a.id}: login, case safeguards, privacy and authority checks passed (${data.cases.length} visible cases).`);
  }finally{await request('/api/auth/logout',post({},cookie));}
 }
 const admin=accounts.find(a=>a.id==='admin'),login=await request('/api/auth/login',post({email:admin.email,password:admin.password}));assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 try{adminAfter=(await json('/api/cases',{headers:{Cookie:cookie}})).cases.length;}finally{await request('/api/auth/logout',post({},cookie));}
 assert.equal(adminAfter,adminBefore,'The live audit must preserve the complaint count.');
 assert.equal((await json('/api/health')).pid,health.pid,'The server must remain stable during the check.');
 report.checks.push('Anonymous access denied; all six demo accounts authenticated; role privacy and authority verified.','Complaint count preserved; no fixture or safeguard records added; server process stayed stable.');
 report.casesBefore=adminBefore;report.casesAfter=adminAfter;report.result='pass';
 console.log(`Live demo check passed. ${adminAfter} saved complaints preserved.`);
}catch(e){report.result='fail';report.error=e.message;process.exitCode=1;console.error('Live demo check failed: '+e.message);}
await mkdir(path.join(root,'qa-artifacts'),{recursive:true});
await writeFile(path.join(root,'qa-artifacts','demo-live-check.json'),JSON.stringify(report,null,2)+'\n','utf8');
