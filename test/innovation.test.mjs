import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server.mjs';
import {DEMO_ACCOUNTS} from '../src/auth.mjs';
import {deadlocks,simulatePolicy,closureRequirements} from '../src/innovation.mjs';

const row=(id,extra={})=>({id,institutionId:'1-LAB',institution:'Synthetic Lab Institute',region:'North',category:'Fee refund',title:'Synthetic refund issue',description:'Synthetic evidence and coordination fixture.',bureau:'PGRC',officer:'Unassigned',status:'New',priority:'High',createdAt:'2026-01-01T00:00:00Z',dueDate:'2099-01-01',ownerId:'student',version:1,messages:[],notes:[],tasks:[],attachments:[],transfers:[],slaEvents:[],history:[{at:'2026-01-01T00:00:00Z',action:'Received',actor:'Intake',bureau:'PGRC'}],...extra});
test('Deadlock Radar distinguishes cycles, chains and satisfied prerequisites',()=>{
 const dep=(id,target,taskId)=>({id,targetCaseId:target,taskId,status:'Waiting'}),a=row('CASE-A',{dependencies:[dep('a','CASE-B')]}),b=row('CASE-B',{dependencies:[dep('b','CASE-A')]}),c=row('CASE-C',{dependencies:[dep('c','CASE-A')]});
 assert.deepEqual(deadlocks({cases:[a,b,c]})[0].caseIds,['CASE-A','CASE-B']);
 assert.equal(deadlocks({cases:[a,{...b,status:'Resolved'},c]}).length,0);
 b.dependencies[0].taskId='task';a.tasks=[{id:'task',status:'Done'}];assert.equal(deadlocks({cases:[a,b,c]}).length,0);
 const many=Array.from({length:12000},(_,i)=>row('CASE-'+i,{dependencies:i===11999?[]:[dep(String(i),'CASE-'+(i+1))]}));assert.equal(deadlocks({cases:many}).length,0);
});
test('Policy Sandbox replays India dates, excludes unknown disposal dates and preserves input',()=>{
 const cases=[row('CASE-A',{createdAt:'2026-03-31T20:00:00Z',dueDate:'2026-04-15'}),row('CASE-B',{status:'Resolved',resolvedAt:'2026-04-03T20:00:00Z',createdAt:'2026-04-01T00:00:00Z',dueDate:'2026-04-02'}),row('CASE-C',{status:'Resolved'})],snapshot=structuredClone(cases);
 const r=simulatePolicy(cases,{slaDays:{High:3,Medium:7,Low:14},route:{PGRC:'Regulation Bureau'}},'2026-04-05');assert.equal(r.activeProposedLate,1);assert.equal(r.baselineLate,1);assert.equal(r.proposedLate,1);assert.equal(r.unknownDisposalDate,1);assert.equal(r.workload.find(w=>w.bureau==='Regulation Bureau').proposed,1);assert.deepEqual(cases,snapshot);assert.doesNotMatch(JSON.stringify(r),/CASE-A|Synthetic refund/);
 assert.throws(()=>simulatePolicy(cases,{slaDays:{High:0,Medium:7,Low:14}}),/1 to 60/);
 assert.match(closureRequirements(row('CASE-A'))[0].label,/receipt alone is insufficient/);
});

test('five safeguards enforce workflow, permission boundaries, stale reviews and persistence',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-innovation-'));let app,base;const cookies={};
 const req=async(user,route,data,method=data===undefined?'GET':'POST')=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookies[user]?{Cookie:cookies[user]}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
 const info=async(user,id)=>(await req(user,`/api/cases/${id}/safeguards`)).data;
 const current=async id=>(await req('admin','/api/cases')).data.cases.find(c=>c.id===id);
 const save=async(user,id,operation,b,method='POST')=>req(user,`/api/cases/${id}/safeguards/${operation}`,{...b,version:(await current(id)).version},method);
 const propose=async(user,id,b,mode='proceed',rest={})=>{const check=await req(user,`/api/cases/${id}/safeguards/check`,b);assert.equal(check.status,200);return save(user,id,'actions',{...b,checkToken:check.data.checkToken,mode,...rest});};
 const upload=async(id,name,content)=>{const r=await req('admin',`/api/cases/${id}/attachments`,{name,type:'text/plain',content:Buffer.from(content).toString('base64')});assert.equal(r.status,201);return r.data.id;};
 async function start(){app=await createApplication({dataDir:dir,initialCases:[row('CASE-A'),row('CASE-B',{bureau:'Regulation Bureau',ownerId:'faculty'}),row('CASE-C',{bureau:'Regional Office'}),row('CASE-WEST',{institutionId:'1-SECRET',region:'West',bureau:'Regional Office',ownerId:'faculty'})],scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;}
 async function stop(){app.closeStreams();await new Promise(r=>app.server.close(r));await app.cleanup();}
 try{await start();for(const a of DEMO_ACCOUNTS){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password})});assert.equal(r.status,200);cookies[a.id]=r.headers.get('set-cookie').split(';')[0];}
  const proposal={type:'Notice',issueKey:'REFUND BATCH A',summary:'Verify the synthetic refund outcome for the same batch.',dueDate:'2099-01-01'};let source,reuse,joint;
  await t.test('new screens are served and anonymous / complainant officer APIs are rejected',async()=>{
   assert.equal((await req('none','/api/innovation')).status,401);assert.equal((await req('student','/api/innovation')).status,403);assert.equal((await req('student','/api/cases/CASE-A/safeguards/check',proposal)).status,403);assert.equal((await req('pgrc','/api/cases/CASE-WEST/safeguards')).status,403);
   const js=await fetch(base+'/safeguards.js');assert.equal(js.status,200);assert.match(await js.text(),/Action Collision Guard/);
  });
  await t.test('server refuses unchecked actions and detects cross-bureau matching issue references',async()=>{
   assert.equal((await save('pgrc','CASE-A','actions',{...proposal,mode:'proceed'})).status,409);
   let r=await propose('pgrc','CASE-A',proposal);assert.equal(r.status,200);source=r.data;
   const check=await req('regulation','/api/cases/CASE-B/safeguards/check',{...proposal,issueKey:' refund   batch a ',dueDate:'2099-01-02'});assert.equal(check.data.collisions.length,1);assert.match(check.data.collisions[0].reason,/different deadline/);
   assert.equal((await save('regulation','CASE-B','actions',{...proposal,issueKey:' refund   batch a ',dueDate:'2099-01-02',mode:'proceed',checkToken:check.data.checkToken})).status,409);
   assert.equal((await propose('regulation','CASE-B',proposal,'separate',{reason:'Trying to bypass required senior authority.'})).status,403);
  });
  await t.test('reuse and joint requests keep source ownership; a common senior approves joint action',async()=>{
   let r=await propose('regulation','CASE-B',proposal,'reuse',{targetActionId:source.id,reason:'Use the source notice instead of issuing another notice.'});assert.equal(r.status,200);reuse=r.data;assert.equal(reuse.status,'Reused');
   r=await propose('regional','CASE-C',proposal,'joint',{targetActionId:source.id,reason:'Request one joint notice covering the verified shared issue.'});assert.equal(r.status,200);joint=r.data;
   assert.equal((await save('pgrc','CASE-A',`actions/${source.id}`,{actionVersion:source.version,status:'Completed',note:'Cannot skip planned to completed.'},'PATCH')).status,409);
   r=await save('admin','CASE-C',`actions/${joint.id}`,{actionVersion:joint.version,decision:'Joint approved',note:'One common lead will coordinate the joint bureau notice.'},'PATCH');assert.equal(r.status,200);assert.equal(r.data.status,'Joint approved');
   assert.ok((await info('regulation','CASE-B')).blockers.some(b=>b.includes('source action')));
   r=await save('pgrc','CASE-A',`actions/${source.id}`,{actionVersion:source.version,status:'Issued',note:'The synthetic notice was recorded as issued.'},'PATCH');assert.equal(r.status,200);source=r.data;
   r=await save('pgrc','CASE-A',`actions/${source.id}`,{actionVersion:source.version,status:'Completed',note:'Institution response reviewed and notice completed.'},'PATCH');assert.equal(r.status,200);source=r.data;
  });
  await t.test('collision checks expire on concurrent changes; unrelated issues and institutions do not collide',async()=>{
   const second={...proposal,type:'Inspection',issueKey:'library-2026'},check=(await req('regulation','/api/cases/CASE-B/safeguards/check',second)).data;
   const created=await propose('pgrc','CASE-A',second);assert.equal(created.status,200);
   assert.equal((await save('regulation','CASE-B','actions',{...second,mode:'proceed',checkToken:check.checkToken})).status,409);
   assert.equal((await req('admin','/api/cases/CASE-WEST/safeguards/check',second)).data.collisions.length,0);
   assert.equal((await req('regulation','/api/cases/CASE-B/safeguards/check',{...second,issueKey:'independent-matter'})).data.collisions.length,0);
   assert.equal((await save('pgrc','CASE-A',`actions/${created.data.id}`,{actionVersion:1,status:'Cancelled',note:'Test inspection cancelled after verifying its scope.'},'PATCH')).status,200);
  });
  await t.test('a senior parallel-action exception needs a reason and preserves its collision receipt',async()=>{
   const p={...proposal,type:'Escalation',issueKey:'senior-exception'};
   const original=await propose('pgrc','CASE-A',p);assert.equal(original.status,200);
   const other=await propose('admin','CASE-B',p,'separate',{reason:'Separate statutory response has a distinct legal purpose; the desks have agreed the scope.'});assert.equal(other.status,200);assert.equal(other.data.receipt.collisions.length,1);assert.equal(other.data.mode,'separate');assert.match(other.data.reason,/distinct legal purpose/);
   for(const [id,a] of [['CASE-A',original.data],['CASE-B',other.data]])assert.equal((await save('admin',id,`actions/${a.id}`,{actionVersion:a.version,status:'Cancelled',note:'The demonstration exception was reviewed and cancelled.'},'PATCH')).status,200);
  });
  let dependencyA,dependencyB,task;
  await t.test('dependency cycles notify once; task completion clears waits; only seniors release',async()=>{
   task=(await req('admin','/api/cases/CASE-A/tasks',{title:'Verify prerequisite inspection report',assignedTo:'pgrc',dueDate:'2099-01-01'})).data;
   dependencyA=(await save('pgrc','CASE-A','dependencies',{targetCaseId:'CASE-B',reason:'Need the regulation decision before proceeding.',dueDate:'2099-01-01'})).data;
   dependencyB=(await save('regulation','CASE-B','dependencies',{targetCaseId:'CASE-A',taskId:task.id,reason:'Need the prerequisite inspection report before deciding.',dueDate:'2099-01-01'})).data;
   let data=(await req('admin','/api/innovation')).data;assert.equal(data.cycles.length,1);assert.deepEqual(data.cycles[0].caseIds,['CASE-A','CASE-B']);
   const notifications=(await req('admin','/api/cases')).data.notifications.filter(n=>n.innovationKey);await req('admin','/api/notifications/read',{});assert.equal((await req('admin','/api/cases')).data.notifications.filter(n=>n.innovationKey).length,notifications.length);
   assert.equal((await save('pgrc','CASE-A',`dependencies/${dependencyA.id}`,{note:'Bureau cannot waive a waiting prerequisite.'},'PATCH')).status,403);
   assert.equal((await req('pgrc',`/api/cases/CASE-A/tasks/${task.id}`,{status:'Done'},'PATCH')).status,200);assert.equal((await req('admin','/api/innovation')).data.cycles.length,0);assert.equal((await info('regulation','CASE-B')).dependencies[0].effectiveStatus,'Satisfied');
   assert.equal((await save('regional','CASE-A',`dependencies/${dependencyA.id}`,{note:'Proceed with documented interim review while the other desk completes work.'},'PATCH')).status,200);
   assert.equal((await save('pgrc','CASE-A','dependencies',{targetCaseId:'CASE-WEST',reason:'A different institution should be rejected.',dueDate:'2099-01-01'})).status,403);
  });
  let passport,file1,file2;
  await t.test('Evidence Passport requires source approval and blocks unrelated / complainant downloads',async()=>{
   file1=await upload('CASE-A','ledger-v1.txt','Synthetic ledger version one.');let r=await save('pgrc','CASE-A','evidence',{kind:'create',attachmentId:file1,title:'Verified synthetic ledger',source:'Fictional institution ledger supplied for workflow testing.'});assert.equal(r.status,200);passport=r.data;
   assert.equal((await save('regulation','CASE-B','evidence',{kind:'attach',passportId:passport.id})).status,403);
   assert.equal((await save('pgrc','CASE-A','evidence',{kind:'share',passportId:passport.id,targetCaseId:'CASE-WEST'})).status,403);
   assert.equal((await save('pgrc','CASE-A','evidence',{kind:'share',passportId:passport.id,targetCaseId:'CASE-B'})).status,200);
   assert.equal((await save('regulation','CASE-B','evidence',{kind:'attach',passportId:passport.id})).status,200);
   let data=await info('regulation','CASE-B');assert.equal(data.evidenceRefs[0].stale,true);assert.match(data.passports[0].versions[0].sha256,/^[a-f0-9]{64}$/);
   assert.equal((await save('regulation','CASE-B','evidence',{kind:'review',passportId:passport.id,passportVersion:1,note:'Compared the shared ledger with the linked refund matter.'})).status,200);
   const url=data.passports[0].versions[0].url;assert.equal((await req('student',url)).status,403);
   const rfile=await fetch(base+url,{headers:{Cookie:cookies.regulation}});assert.equal(await rfile.text(),'Synthetic ledger version one.');
  });
  await t.test('new evidence versions preserve old bytes, notify reviewers and invalidate closure readiness',async()=>{
   file2=await upload('CASE-A','ledger-v2.txt','Synthetic corrected ledger version two.');const r=await save('pgrc','CASE-A','evidence',{kind:'version',passportId:passport.id,passportVersion:1,attachmentId:file2,source:'Correction to the fictional ledger; review the updated totals.'});assert.equal(r.status,200);assert.equal(r.data.versions.length,2);
   assert.equal((await info('regulation','CASE-B')).evidenceRefs[0].stale,true);assert.ok((await info('regulation','CASE-B')).blockers.some(x=>x.includes('latest version')));
   assert.equal((await save('regulation','CASE-B','evidence',{kind:'review',passportId:passport.id,passportVersion:1,note:'An obsolete version must not be marked current.'})).status,409);
   for(const id of ['CASE-A','CASE-B'])assert.equal((await save('admin',id,'evidence',{kind:'review',passportId:passport.id,passportVersion:2,note:'Reviewed corrected source figures against the case remedy.'})).status,200);
   const p=(await info('pgrc','CASE-A')).passports[0];assert.equal(p.versions.length,2);assert.equal(await(await fetch(base+p.versions[0].url,{headers:{Cookie:cookies.pgrc}})).text(),'Synthetic ledger version one.');
   assert.equal((await save('regulation','CASE-B','evidence',{kind:'version',passportId:passport.id,passportVersion:2,attachmentId:file2,source:'Trying to alter another desk evidence.'})).status,403);
  });
  await t.test('evidence integrity failures block downloads and proof review without losing prior records',async()=>{
   const a=(await current('CASE-A')).attachments.find(a=>a.id===file2),file=path.resolve(dir,'attachments',a.stored);assert.equal(path.dirname(file),path.join(dir,'attachments'));const original=await readFile(file);
   try{await writeFile(file,'Tampered fixture bytes.');
    const url=(await info('pgrc','CASE-A')).passports[0].versions[1].url;assert.equal((await req('pgrc',url)).status,409);
    const proof=await save('pgrc','CASE-A','closure',{checks:['remedy','response','communication'],evidence:'passport:'+passport.id,summary:'This review must not accept a file whose stored content changed.'});assert.equal(proof.status,409);assert.match(proof.data.error,/integrity check/);
   }finally{await writeFile(file,original);}
  });
  await t.test('a source revision invalidates another desk proof even when its case version is unchanged',async()=>{
   const proof={checks:['remedy','response','communication'],evidence:'passport:'+passport.id,summary:'Reviewed the current shared ledger, the requested remedy and institution response, and recorded communication.'};
   assert.equal((await save('regulation','CASE-B','closure',proof)).status,200);const before=await current('CASE-B');
   const file3=await upload('CASE-A','ledger-v3.txt','Synthetic final ledger version three.');assert.equal((await save('pgrc','CASE-A','evidence',{kind:'version',passportId:passport.id,passportVersion:2,attachmentId:file3,source:'Final correction to fictional evidence, requiring a fresh linked-case review.'})).status,200);
   assert.equal((await current('CASE-B')).version,before.version);assert.equal((await req('regulation','/api/cases/CASE-B',{version:before.version,status:'Resolved',note:'The source changed after our proof review.'},'PATCH')).status,409);
   for(const id of ['CASE-A','CASE-B'])assert.equal((await save('admin',id,'evidence',{kind:'review',passportId:passport.id,passportVersion:3,note:'Compared the latest corrected figures against the verified remedy.'})).status,200);
  });
  await t.test('complainant objections prevent closure until review; incomplete or stale proof is rejected',async()=>{
   let c=await current('CASE-A');assert.equal((await req('pgrc','/api/cases/CASE-A',{version:c.version,status:'Resolved',note:'Cannot resolve without a verified proof checklist.'},'PATCH')).status,409);
   const o=await req('student','/api/cases/CASE-A/safeguards/objections',{text:'The synthetic refund amount still needs clarification.'});assert.equal(o.status,200);
   const proof={checks:['remedy','response','communication'],evidence:'passport:'+passport.id,summary:'Compared the corrected ledger with the refund request, verified the remedy, and communicated the findings to the complainant.'};
   assert.equal((await save('pgrc','CASE-A','closure',proof)).status,409);
   assert.equal((await save('pgrc','CASE-A',`objections/${o.data.id}`,{response:'Checked the corrected amount and explained the verified outcome.'},'PATCH')).status,200);
   assert.equal((await save('pgrc','CASE-A','closure',{...proof,checks:['remedy']})).status,400);
   assert.equal((await save('pgrc','CASE-A','closure',proof)).status,200);
   c=await current('CASE-A');assert.equal((await req('pgrc','/api/cases/CASE-A',{version:c.version,note:'A new update invalidates the previously checked case revision.'},'PATCH')).status,200);
   c=await current('CASE-A');assert.equal((await req('pgrc','/api/cases/CASE-A',{version:c.version,status:'Resolved',note:'The prior proof review is now stale.'},'PATCH')).status,409);
   assert.equal((await save('pgrc','CASE-A','closure',proof)).status,200);c=await current('CASE-A');assert.equal((await req('pgrc','/api/cases/CASE-A',{version:c.version,status:'Resolved',note:'Disposed after completing the documented proof review.'},'PATCH')).status,200);
   const mine=(await req('student','/api/cases')).data.cases.find(c=>c.id==='CASE-A');for(const k of ['officialActions','dependencies','evidenceRefs','closureProof','objections'])assert.equal(mine[k],undefined);
   const publicProof=await info('student','CASE-A');assert.ok(publicProof.proof.summary);assert.equal(publicProof.actions,undefined);assert.equal((await req('faculty','/api/cases/CASE-A/safeguards')).status,403);
  });
  await t.test('Policy Sandbox is aggregate, senior-scoped, persistent and cannot mutate live policy or cases',async()=>{
   const before=(await req('admin','/api/cases')).data;const input={slaDays:{High:2,Medium:5,Low:10},route:{PGRC:'Regulation Bureau'}};
   assert.equal((await req('pgrc','/api/innovation/sandbox',input)).status,403);assert.equal((await req('student','/api/innovation/sandbox',input)).status,403);
   const r=await req('regional','/api/innovation/sandbox',input);assert.equal(r.status,201);assert.equal(r.data.result.cohort,3);assert.doesNotMatch(JSON.stringify(r.data.result),/CASE-WEST|Synthetic/);
   const after=(await req('admin','/api/cases')).data;assert.deepEqual(after.cases,before.cases);assert.deepEqual(after.settings,before.settings);
   assert.equal((await req('admin','/api/innovation/sandbox',{...input,slaDays:{High:-1,Medium:5,Low:10}})).status,400);
   assert.equal((await req('admin','/api/innovation')).data.policyRuns.length,0);assert.equal((await req('regional','/api/innovation')).data.policyRuns.length,1);
  });
  await t.test('all five safeguard records survive restart without changing original case counts',async()=>{
   await stop();await start();assert.equal((await req('admin','/api/cases')).data.cases.length,4);assert.equal((await current('CASE-A')).status,'Resolved');const d=await info('admin','CASE-A');assert.equal(d.passports[0].versions.length,3);assert.equal(d.actions.length,3);assert.equal(d.dependencies[0].status,'Released');assert.equal(d.objections[0].status,'Reviewed');assert.ok(d.proof.summary);assert.equal((await req('regional','/api/innovation')).data.policyRuns.length,1);
  });
 }finally{if(app?.server.listening)await stop();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('samanvay-innovation-'));await rm(dir,{recursive:true,force:true});}
});
