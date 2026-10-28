import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server.mjs';
import {semanticPairs} from '../src/semantic.mjs';
import {sameInstitution,caseSummary} from '../src/institutions.mjs';
import {filterCases,analytics,summarize} from '../public/insights.js';

const row=(id,overrides={})=>({id,institutionId:'1-TEST',institution:'Test Engineering Institute',region:'North',category:'Faculty grievance',title:'Salary pending',description:'Faculty salaries have not been paid.',bureau:'PGRC',officer:'Unassigned',status:'New',priority:'High',createdAt:'2026-01-01T00:00:00Z',dueDate:'2026-01-10',ownerId:'student',version:1,messages:[],notes:[],tasks:[],attachments:[],transfers:[],slaEvents:[],history:[{at:'2026-01-01T00:00:00Z',action:'Received',actor:'Intake',bureau:'PGRC'}],...overrides});

test('institution identity rule flags unrelated cross-bureau actions without claiming a duplicate',()=>{
 const a=row('CASE-A'),b=row('CASE-B',{bureau:'Regulation Bureau',title:'Library compliance review',description:'Library resources do not match the approval disclosure.',category:'Infrastructure'});
 const pairs=semanticPairs([a,b]);assert.equal(pairs.length,1);assert.equal(pairs[0].crossBureau,true);assert.equal(pairs[0].semanticMatch,false);assert.match(pairs[0].reason,/Coordination Required/);
 assert.equal(semanticPairs([a,{...b,status:'Resolved'}]).length,0);
 assert.equal(semanticPairs([a,{...b,institutionId:'1-OTHER'}]).length,0);
 assert.equal(sameInstitution({...a,institutionId:''},{...b,institutionId:'',institution:' Test Engineering Institute! '}),true);
 assert.equal(sameInstitution({...a,institutionId:''},{...b,institutionId:'',region:'West'}),false);
});

test('all required case filters combine; receipt dates use India calendar boundaries',()=>{
 const a=row('CASE-A',{createdAt:'2026-03-31T20:00:00Z',transfers:[{status:'Approved'}]}),b=row('CASE-B',{region:'West',category:'Infrastructure',status:'In progress'});
 assert.deepEqual(filterCases([a,b],{query:'1-test',region:'North',category:'Faculty grievance',status:'New',bureau:'PGRC',priority:'High',from:'2026-04-01',to:'2026-04-01',transferred:true}).map(c=>c.id),['CASE-A']);
 assert.equal(filterCases([a,b],{from:'2026-03-31',to:'2026-03-31'}).length,0);
 assert.equal(filterCases([a,b],{query:'missing institution'}).length,0);
 assert.equal(filterCases([a,b,row('CASE-C',{status:'Awaiting response'})],{status:'Pending'}).length,2);
});

test('reports reconcile ageing, completed transfers, disposal rate and monthly / quarterly events',()=>{
 const rows=[row('CASE-A'),row('CASE-B',{status:'In progress',createdAt:'2026-03-31T20:00:00Z',transfers:[{status:'Approved'}]}),row('CASE-C',{status:'Resolved',createdAt:'2026-03-01T00:00:00Z',resolvedAt:'2026-04-02T00:00:00Z'})];
 const r=analytics(rows,[{a:'CASE-A',b:'CASE-B',crossBureau:true,semanticMatch:false}],[], '2026-04-10');
 assert.equal(r.summary.total,3);assert.equal(r.summary.pending,1);assert.equal(r.summary.underProcess,1);assert.equal(r.summary.disposed,1);assert.equal(r.summary.transferred,1);assert.equal(r.summary.disposalRate,33.3);assert.equal(r.summary.overdue,2);
 assert.equal(r.ageing.reduce((n,x)=>n+x.count,0),2);assert.equal(r.ageing.find(x=>x.name==='90+ days').count,1);
 assert.deepEqual(r.quarterly,[{period:'2026-Q1',received:2,disposed:0},{period:'2026-Q2',received:1,disposed:1}]);
 assert.equal(r.monthly.find(x=>x.period==='2026-04').disposed,1);assert.equal(r.overlaps.crossBureau,1);assert.equal(summarize([]).disposalRate,0);
 assert.equal(analytics(rows,[{a:'CASE-A',b:'SECRET'}]).overlaps.potential,0);
});

test('last / next actions derive from history and open action items',()=>{
 const c=row('CASE-A',{tasks:[{title:'Verify evidence',dueDate:'2026-01-08',status:'Open'}]});const s=caseSummary(c);assert.equal(s.lastAction,'Received');assert.equal(s.lastActionBy,'Intake');assert.equal(s.nextAction,'Verify evidence');assert.equal(s.nextActionDue,'2026-01-08');assert.equal(caseSummary({...c,status:'Resolved',tasks:[]}).nextAction,'No further action — disposed');
});

test('institution profiles, mapping, notifications, live updates and persistence enforce permissions',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-requirements-'));let app,base;
 const cookies={};const raw=(id,route,opts={})=>fetch(base+route,{...opts,headers:{...opts.headers,...(id?{Cookie:cookies[id]}:{})}});
 const req=async(id,route,data,method=data===undefined?'GET':'POST')=>{const r=await raw(id,route,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 async function start(){app=await createApplication({dataDir:dir,initialCases:[row('CASE-A'),row('CASE-B',{bureau:'Regulation Bureau',category:'Infrastructure',title:'Library compliance',description:'Library has insufficient books and resources.'}),row('CASE-C',{institutionId:'1-WEST',institution:'West College',region:'West',bureau:'Regional Office',ownerId:'faculty'})],scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;}
 async function stop(){app.closeStreams();await new Promise(r=>app.server.close(r));await app.cleanup();}
 try{await start();
  for(const [id,pw] of [['admin','Admin'],['pgrc','Pgrc'],['regional','Regional'],['student','Student']]){const r=await raw(null,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:id+'@samanvay.demo',password:pw+'@2026'})});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
  await t.test('directory and complete chronology are scoped to authorized officials',async()=>{
   assert.equal((await req(null,'/api/institutions')).status,401);assert.equal((await req('student','/api/institutions')).status,403);
   const admin=await req('admin','/api/institutions');assert.equal(admin.data.institutions.length,2);
   const profile=await req('pgrc','/api/institutions/1-TEST');assert.equal(profile.data.cases.length,2);assert.equal(profile.data.history.length,2);assert.equal(profile.data.canEdit,false);
   assert.equal((await req('pgrc','/api/institutions/1-WEST')).status,403);assert.equal((await req('regional','/api/institutions/1-WEST')).status,403);
  });
  await t.test('new client modules are served as JavaScript and selected theme is present',async()=>{
   for(const file of ['/requirements.js','/insights.js','/app.js','/roles.js']){const r=await raw(null,file);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.ok((await r.text()).length>100);}
   const page=await(await raw(null,'/')).text();assert.match(page,/data-design="sandstone"/);assert.match(page,/data-view="institutions"/);
  });
  await t.test('profile validation, senior authority, canonical aliases and revision conflicts',async()=>{
   const fields={version:1,name:'Test Engineering Institute',address:'Synthetic campus address for testing',city:'Test City',state:'Test State',pincode:'110001',contact:'Office test contact',aliases:['TEI Campus']};
   assert.equal((await req('pgrc','/api/institutions/1-TEST',fields,'PATCH')).status,403);
   assert.equal((await req('regional','/api/institutions/1-TEST',{...fields,pincode:'bad'},'PATCH')).status,400);
   const r=await req('regional','/api/institutions/1-TEST',fields,'PATCH');assert.equal(r.status,200);assert.equal(r.data.institution.version,2);
   assert.equal((await req('admin','/api/institutions/1-TEST',fields,'PATCH')).status,409);
   const input={title:'Fee refund follow up',description:'A synthetic refund request requiring coordination.',institution:'TEI Campus',institutionId:'1-TEST',region:'West',category:'Fee refund',bureau:'PGRC',priority:'High'};
   const c=await req('student','/api/cases',input);assert.equal(c.status,201);assert.equal(c.data.institution,'Test Engineering Institute');assert.equal(c.data.region,'North');
   assert.equal((await req('regional','/api/cases',{...input,institution:'West College',institutionId:'1-WEST'})).status,403);
  });
  await t.test('overlap alerts are delivered once and excluded from complainant inboxes',async()=>{
   const first=(await req('pgrc','/api/cases')).data;assert.ok(first.related.some(p=>p.crossBureau&&!p.semanticMatch));const key=first.notifications.find(n=>n.overlapKey)?.overlapKey;assert.ok(key);
   await req('admin','/api/sla/run',{});await req('admin','/api/sla/run',{});
   const latest=(await req('pgrc','/api/cases')).data;assert.equal(latest.notifications.filter(n=>n.overlapKey===key).length,1);assert.equal((await req('student','/api/cases')).data.notifications.some(n=>n.overlapKey),false);
  });
  await t.test('last / next action and responsible bureau are recorded without leaking internal notes',async()=>{
   const c=(await req('admin','/api/cases')).data.cases.find(c=>c.id==='CASE-A');const update=await req('pgrc','/api/cases/CASE-A',{version:c.version,nextAction:'Verify the institution response',note:'Initial evidence review completed.'},'PATCH');assert.equal(update.status,200);assert.equal(update.data.nextAction,'Verify the institution response');assert.equal(update.data.history.at(-1).bureau,'PGRC');
   await req('pgrc','/api/cases/CASE-A/coordination',{kind:'note',note:'Private deliberation for officers only'});
   const owner=(await req('student','/api/cases')).data.cases.find(c=>c.id==='CASE-A');assert.doesNotMatch(owner.lastAction,/Internal/);assert.equal(owner.notes,undefined);
  });
  await t.test('manual mapping supports same-institution historical cases and rejects unrelated IDs',async()=>{
   const upload=await req('admin','/api/cases/CASE-B/attachments',{name:'inspection.txt',type:'text/plain',content:Buffer.from('Synthetic inspection and corrective action evidence.').toString('base64')});assert.equal(upload.status,201);let c=(await req('admin','/api/cases')).data.cases.find(c=>c.id==='CASE-B');assert.equal((await req('admin','/api/cases/CASE-B/safeguards/closure',{version:c.version,checks:['remedy','response','communication'],evidence:'attachment:'+upload.data.id,summary:'Verified corrective work using the inspection record and communicated the compliance findings.'})).status,200);c=(await req('admin','/api/cases')).data.cases.find(c=>c.id==='CASE-B');assert.equal((await req('admin','/api/cases/CASE-B',{version:c.version,status:'Resolved',note:'Compliance verification and disposal completed.'},'PATCH')).status,200);
   assert.equal((await req('admin','/api/reviews',{a:'CASE-A',b:'CASE-B',decision:'Linked',note:'Verified shared institution for historical coordination.',version:0})).status,200);
   assert.equal((await req('admin','/api/reviews',{a:'CASE-A',b:'CASE-C',decision:'Linked',note:'Different institutions must not be mapped.',version:0})).status,400);
  });
  await t.test('live stream requires a session and delivers change events without case payloads',async()=>{
   assert.equal((await raw(null,'/api/events')).status,401);const controller=new AbortController();const response=await raw('admin','/api/events',{signal:controller.signal});assert.match(response.headers.get('content-type'),/event-stream/);const reader=response.body.getReader(),decoder=new TextDecoder();let text=decoder.decode((await reader.read()).value);assert.match(text,/event: ready/);
   try{const c=(await req('admin','/api/cases')).data.cases.find(c=>c.id==='CASE-A');await req('admin','/api/cases/CASE-A',{version:c.version,note:'Checking real time event propagation.'},'PATCH');text=decoder.decode((await reader.read()).value);assert.match(text,/event: change/);assert.doesNotMatch(text,/CASE-A|institution|salary/i);}finally{controller.abort();}
  });
  await t.test('profile survives server restart and old sessions remain usable',async()=>{
   await stop();await start();const r=await req('admin','/api/institutions/1-TEST');assert.equal(r.status,200);assert.equal(r.data.institution.address,'Synthetic campus address for testing');assert.deepEqual(r.data.institution.aliases,['TEI Campus']);assert.ok(r.data.cases.length>=3);
  });
 }finally{if(app?.server.listening)await stop();const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('samanvay-requirements-'));await rm(resolved,{recursive:true,force:true});}
});
