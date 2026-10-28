import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseImportFile,parseInWorker} from '../src/import-file.mjs';
import {suggestMapping,buildImportPlan} from '../src/institution-import.mjs';
import {openStore} from '../src/store.mjs';
import {createApplication} from '../server.mjs';

const fixture=name=>readFile(new URL('./fixtures/import/'+name,import.meta.url));
const csv=(rows,header='AICTE Permanent ID,Institution Name,Region,Address,State,PIN Code,Source,Academic Year')=>Buffer.from(header+'\r\n'+rows.join('\r\n'));
const upload=bytes=>({fileName:'institutions.csv',content:bytes.toString('base64')});

test('CSV preserves UTF-8, leading-zero text IDs, quoted commas, newlines and file row references',async()=>{
 const [sheet]=await parseImportFile(Buffer.from('\uFEFFAICTE Permanent ID,Institution Name,Region,Address\r\n01-ABC,"Fictional संस्था, College",North,"Campus line one\nCampus line two"\r\n,,,\r\n02-XYZ,Other Fictional College,South,Address'),'demo.csv');
 assert.equal(sheet.rows.length,2);assert.equal(sheet.rows[0].cells[0],'01-ABC');assert.equal(sheet.rows[0].cells[1],'Fictional संस्था, College');assert.match(sheet.rows[0].cells[3],/\n/);assert.equal(sheet.rows[1].row,4);
 const plan=buildImportPlan(sheet,suggestMapping(sheet.headers),'',[]);assert.equal(plan.summary.ready,2);assert.equal(plan.rows[0].record.id,'01-ABC');
});

test('mapping detects aliases, supports a default region and keeps AISHE separate',async()=>{
 const [sheet]=await parseImportFile(Buffer.from('College Code,College Title,AISHE Code\n1-NEW,Fictional College,C-123'),'mapped.csv');
 const auto=suggestMapping(sheet.headers);assert.equal(auto.id,null);assert.equal(auto.aisheCode,2);
 assert.equal(buildImportPlan(sheet,auto,'North',[]).summary.ready,0);
 const plan=buildImportPlan(sheet,{...auto,id:0,name:1},'North',[]);assert.equal(plan.summary.ready,1);assert.equal(plan.rows[0].record.aisheCode,'C-123');
 assert.throws(()=>buildImportPlan(sheet,{...auto,id:0,name:0},'North',[]),/one field/);
 assert.throws(()=>buildImportPlan(sheet,{...auto,id:20},'North',[]));
});

test('preview blocks every repeated ID, invalid values and mismatched existing names',async()=>{
 const [sheet]=await parseImportFile(csv(['d-1,Fictional One,North','','D-1,Fictional Two,South','1-EXIST,Existing Demo,North','1-EXIST,Wrong College,North',',Missing ID,North','1-PIN,Invalid Pin College,North,,,123','1-REG,Missing Region College,','1-OK,Ready College,South']),'rows.csv');
 const plan=buildImportPlan(sheet,suggestMapping(sheet.headers),'',[{id:'1-EXIST',name:'Existing Demo',region:'North'}]);
 assert.deepEqual(plan.summary,{total:8,ready:1,invalid:3,duplicates:2,existing:1,conflicts:1});assert.ok(plan.rows.filter(r=>r.record.id==='D-1').every(r=>r.status==='duplicate-file'));
});

test('malformed, oversized, non-UTF8, unsupported and empty files return actionable errors',async()=>{
 for(const [bytes,name] of [[Buffer.from('a,"unclosed\n'),'bad.csv'],[Buffer.from([255,254,0,0]),'bad.csv'],[Buffer.alloc(0),'empty.csv'],[Buffer.from('x'),'old.xls'],[Buffer.from('x'),'fake.xlsx'],[Buffer.alloc(2*1024*1024+1),'big.csv'],[Buffer.from('AICTE Permanent ID,Institution Name\n,\n'),'empty.csv']])await assert.rejects(parseImportFile(bytes,name),e=>e.status===400);
 await assert.rejects(parseImportFile(Buffer.from('ID,Name\n'+Array.from({length:2001},(_,i)=>i+',Demo').join('\n')),'rows.csv'),/2,000|2000/);
});

test('real Excel workbooks parse in the worker; formulas and compressed expansion are rejected',async()=>{
 const sheets=await parseInWorker(await fixture('institutions.xlsx'),'institutions.xlsx');assert.deepEqual(sheets.map(s=>s.sheet),['North data','South data']);
 assert.equal(sheets[0].rows[0].cells[6],110001);assert.equal(buildImportPlan(sheets[1],suggestMapping(sheets[1].headers),'',[]).rows[0].record.region,'South');
 await assert.rejects(parseInWorker(await fixture('formula.xlsx'),'formula.xlsx'),/Formula/);
 await assert.rejects(parseInWorker(await fixture('oversized-expanded.xlsx'),'oversized.xlsx'),e=>e.status===400);
});

test('SQLite import persistence is atomic when a receipt constraint fails',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-import-atomic-'));let store;
 try{store=await openStore(dir,[]);const state=store.read();state.institutions.push({id:'1-NEW',name:'Fictional Test',region:'North',aliases:[],version:1});state.imports=[{id:'same'},{id:'same'}];assert.throws(()=>store.save(state));assert.equal(store.read().institutions.length,0);assert.equal(store.read().imports.length,0);}finally{store?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
});

test('institution import API previews, commits, protects scope and persists receipts',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-import-api-'));let app,base;const cookies={};
 const seed={id:'CASE-EXIST',institutionId:'1-EXIST',institution:'Existing Demo',region:'North',bureau:'PGRC',title:'Fictional initial complaint',description:'Synthetic initial complaint for testing only.',category:'Fee refund',priority:'High',status:'New',officer:'Unassigned',createdAt:'2026-01-01T00:00:00Z',dueDate:'2026-12-31',history:[]};
 const raw=(id,route,opts={})=>fetch(base+route,{...opts,headers:{...opts.headers,...(id?{Cookie:cookies[id]}:{})}});
 const req=async(id,route,data,method=data===undefined?'GET':'POST')=>{const r=await raw(id,route,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 async function start(){app=await createApplication({dataDir:dir,initialCases:[seed],scheduler:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;}
 async function stop(){app.closeStreams();await new Promise(resolve=>app.server.close(resolve));await app.cleanup();}
 try{await start();for(const [id,password] of [['admin','Admin'],['regional','Regional'],['pgrc','Pgrc'],['student','Student']]){const r=await raw(null,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:id+'@samanvay.demo',password:password+'@2026'})});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
  await t.test('only Admin can preview, commit, download templates or read import history',async()=>{
   assert.equal((await req(null,'/api/institution-imports')).status,401);
   for(const id of ['pgrc','regional','student']){assert.equal((await req(id,'/api/institution-imports/preview',upload(csv(['1-NO,Blocked College,North'])))).status,403);assert.equal((await req(id,'/api/institution-imports')).status,403);assert.equal((await raw(id,'/api/institution-imports/template')).status,403);}
   for(const route of ['/api/institution-imports/template','/api/institution-imports/template?format=xlsx']){const r=await raw('admin',route);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);const bytes=Buffer.from(await r.arrayBuffer());const sheets=await parseImportFile(bytes,route.endsWith('xlsx')?'template.xlsx':'template.csv');assert.equal(sheets[0].rows.length,1);}
  });
  let preview,receipt;
  await t.test('preview has no saved-data side effects and separates valid, invalid and duplicate rows',async()=>{
   const result=await req('admin','/api/institution-imports/preview',upload(csv(['DEMO-IMP-N,Fictional Imported North,North,Campus,Delhi,110001,Test only,2026-27','DEMO-IMP-S,Fictional Imported South,South,Campus,Tamil Nadu,600001,Test only,2026-27',',Missing ID College,North','DUP-1,Fictional Duplicate One,North','dup-1,Fictional Duplicate Two,North','1-EXIST,Existing Demo,North'])));assert.equal(result.status,200);preview=result.data;assert.equal(preview.summary.ready,2);assert.equal(preview.summary.duplicates,2);assert.equal(preview.summary.existing,1);assert.equal(preview.summary.invalid,1);assert.equal((await req('admin','/api/institutions')).data.institutions.length,1);assert.equal((await req('admin','/api/backups')).data.backups.length,0);
  });
  await t.test('save creates a backup, adds only valid profiles and preserves existing complaints',async()=>{
   const result=await req('admin',`/api/institution-imports/${preview.id}/commit`,{revision:preview.revision});assert.equal(result.status,201);receipt=result.data.receipt;assert.equal(receipt.added,2);assert.equal(receipt.skipped,4);assert.ok(receipt.backupId);
   const before=new DatabaseSync(path.join(dir,'backups',receipt.backupId,'samanvay.sqlite'),{readOnly:true});assert.equal(before.prepare('SELECT COUNT(*) AS n FROM institutions').get().n,1);before.close();
   const cases=(await req('admin','/api/cases')).data.cases;assert.equal(cases.length,1);assert.equal(cases[0].version,1);
   const directory=(await req('admin','/api/institutions')).data.institutions;assert.equal(directory.length,3);assert.equal(directory.find(p=>p.id==='DEMO-IMP-N').caseCount,0);assert.equal(directory.find(p=>p.id==='1-EXIST').name,'Existing Demo');
   const profile=await req('admin','/api/institutions/DEMO-IMP-N');assert.equal(profile.status,200);assert.equal(profile.data.cases.length,0);assert.equal(profile.data.institution.provenance.sha256,receipt.sha256);assert.equal(profile.data.institution.source,'Test only');
   assert.equal((await req('regional','/api/institutions/DEMO-IMP-N')).status,200);assert.equal((await req('regional','/api/institutions/DEMO-IMP-S')).status,403);assert.equal((await req('pgrc','/api/institutions/DEMO-IMP-N')).status,403);assert.equal((await req('student','/api/institutions')).status,403);
  });
  await t.test('retries replay one saved receipt without adding duplicates',async()=>{
   const repeat=await req('admin',`/api/institution-imports/${preview.id}/commit`,{revision:preview.revision});assert.equal(repeat.status,200);assert.equal(repeat.data.replayed,true);assert.equal(repeat.data.receipt.id,receipt.id);assert.equal((await req('admin','/api/institution-imports')).data.imports.length,1);assert.equal((await req('admin','/api/institutions')).data.institutions.length,3);
  });
  await t.test('Excel sheet changes support remapping and reject stale preview revisions',async()=>{
   const r=await req('admin','/api/institution-imports/preview',{fileName:'colleges.xlsx',content:(await fixture('institutions.xlsx')).toString('base64')});assert.equal(r.status,200);const first=r.data;assert.equal(first.sheet,'North data');
   const mapped=await req('admin','/api/institution-imports/preview',{previewId:first.id,sheet:'South data'});assert.equal(mapped.status,200);assert.equal(mapped.data.rows[0].record.id,'DEMO-EXCEL-S');assert.equal((await req('admin',`/api/institution-imports/${first.id}/commit`,{revision:first.revision})).status,409);
   assert.equal((await req('admin',`/api/institution-imports/${first.id}/commit`,{revision:mapped.data.revision})).status,201);
  });
  await t.test('manual mapping fills a default region and refuses duplicate selected columns',async()=>{
   const result=await req('admin','/api/institution-imports/preview',upload(Buffer.from('College Code,College Title\nDEMO-MAPPED,Fictional Mapped College')));assert.equal(result.status,200);const first=result.data;assert.equal(first.summary.ready,0);
   assert.equal((await req('admin',`/api/institution-imports/${first.id}/commit`,{revision:first.revision})).status,400);
   assert.equal((await req('admin','/api/institution-imports/preview',{previewId:first.id,mapping:{id:0,name:0},defaultRegion:'North'})).status,400);
   const r=await req('admin','/api/institution-imports/preview',{previewId:first.id,mapping:{id:0,name:1},defaultRegion:'North'});assert.equal(r.status,200);assert.equal(r.data.summary.ready,1);assert.equal((await req('admin',`/api/institution-imports/${first.id}/commit`,{revision:r.data.revision})).status,201);
  });
  await t.test('changed directory invalidates another pending preview and never overwrites its ID',async()=>{
   const file=upload(csv(['DEMO-RACE,Fictional Race College,North'])),one=(await req('admin','/api/institution-imports/preview',file)).data,two=(await req('admin','/api/institution-imports/preview',file)).data;
   assert.equal((await req('admin',`/api/institution-imports/${one.id}/commit`,{revision:one.revision})).status,201);assert.equal((await req('admin',`/api/institution-imports/${two.id}/commit`,{revision:two.revision})).status,409);assert.equal((await req('admin','/api/institutions')).data.institutions.filter(p=>p.id==='DEMO-RACE').length,1);
  });
  await t.test('bad files, expired previews and invalid payloads do not add institutions',async()=>{
   const count=(await req('admin','/api/institutions')).data.institutions.length;
   for(const data of [{fileName:'bad.csv',content:'!!!!'},upload(Buffer.from('name\n"bad')),{fileName:'formulas.xlsx',content:(await fixture('formula.xlsx')).toString('base64')},{fileName:'bad.exe',content:'eA=='},upload(Buffer.alloc(2*1024*1024+1))])assert.equal((await req('admin','/api/institution-imports/preview',data)).status,400);
   assert.equal((await req('admin','/api/institution-imports/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/commit',{revision:1})).status,410);assert.equal((await req('admin','/api/institutions')).data.institutions.length,count);
  });
  await t.test('profiles and idempotent receipts survive restart',async()=>{
   await stop();await start();const profile=await req('admin','/api/institutions/DEMO-IMP-N');assert.equal(profile.status,200);assert.equal(profile.data.institution.importId,receipt.id);const r=await req('admin',`/api/institution-imports/${receipt.id}/commit`,{revision:preview.revision});assert.equal(r.status,200);assert.equal(r.data.replayed,true);
  });
 }finally{if(app?.server.listening)await stop();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('samanvay-import-api-'));await rm(dir,{recursive:true,force:true});}
});
