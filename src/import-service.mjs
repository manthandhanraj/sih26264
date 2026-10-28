import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {RequestError,text,REGIONS} from './validation.mjs';
import {IMPORT_LIMITS,parseInWorker} from './import-file.mjs';
import {IMPORT_FIELDS,suggestMapping,buildImportPlan} from './institution-import.mjs';

export function createImportService({getState,transact,backup}){
 const jobs=new Map();let reading=0;
 const expire=()=>{for(const [id,j] of jobs)if(j.expiresAt<Date.now())jobs.delete(id);};
 function jobFor(id,user){expire();const job=jobs.get(id);if(!job||job.userId!==user.id)throw new RequestError('Preview expired or is unavailable. Upload the file again.',410);return job;}
 function response(job){return {id:job.id,revision:job.revision,fileName:job.fileName,expiresAt:job.expiresAt,sheets:job.sheets.map(s=>s.sheet),sheet:job.selected.sheet,headers:job.selected.headers,fields:IMPORT_FIELDS,regions:REGIONS,limits:IMPORT_LIMITS,...job.plan,signature:undefined};}
 return {async handle({route,req,res,user,body,reply}){
  if(route==='/api/institution-imports/template'&&req.method==='GET'){
   if(new URL(req.url,'http://localhost').searchParams.get('format')==='xlsx'){
    const file=await readFile(new URL('../templates/institution-import-template.xlsx',import.meta.url));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="institution-import-template.xlsx"','Cache-Control':'no-store'});res.end(file);return true;
   }
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="institution-import-template.csv"','Cache-Control':'no-store'});
   res.end('\uFEFFAICTE Permanent ID,Institution Name,Region,Address,District,State,PIN Code,Contact,Aliases,AISHE Code,Source,Academic Year\r\nDEMO-EXAMPLE-001,Fictional Demonstration Institute,North,Example campus address,Example District,Example State,110001,office@example.invalid,Demo Institute,,Fictional template only,2026-27\r\n');return true;
  }
  if(route==='/api/institution-imports'&&req.method==='GET'){return reply(res,200,{imports:(getState().imports||[]).filter(r=>r.userId===user.id).slice(-20).reverse()}),true;}
  if(route==='/api/institution-imports/preview'&&req.method==='POST'){
   const input=await body(req);let job;
   if(input.previewId){job=jobFor(input.previewId,user);}
   else {
    expire();if(reading>=2)throw new RequestError('Two files are being read. Try again shortly.',429);
    const fileName=text(input.fileName,'File name',1,150).split(/[\\/]/).at(-1);
    if(!/\.(csv|xlsx)$/i.test(fileName))throw new RequestError('Upload .csv or .xlsx. Save legacy .xls as .xlsx first.');
    if(typeof input.content!=='string'||input.content.length>Math.ceil(IMPORT_LIMITS.bytes/3)*4||input.content.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content))throw new RequestError('File is invalid or exceeds the 2 MB limit.');
    const bytes=Buffer.from(input.content,'base64');if(bytes.toString('base64')!==input.content)throw new RequestError('Invalid file encoding.');
    reading++;let sheets;try{sheets=await parseInWorker(bytes,fileName);}finally{reading--;}
    const own=[...jobs.values()].filter(j=>j.userId===user.id).sort((a,b)=>a.expiresAt-b.expiresAt);while(own.length>=2)jobs.delete(own.shift().id);
    if(jobs.size>=6)jobs.delete(jobs.keys().next().value);
    job={id:randomUUID(),userId:user.id,fileName,hash:createHash('sha256').update(bytes).digest('hex'),sheets,revision:0,expiresAt:Date.now()+15*60000};
   }
   const selected=input.sheet===undefined?job.selected||job.sheets[0]:job.sheets.find(s=>s.sheet===input.sheet);
   if(!selected)throw new RequestError('Choose an available workbook sheet.');
   const mapping=input.mapping||suggestMapping(selected.headers),plan=buildImportPlan(selected,mapping,input.defaultRegion||'',getState().institutions);
   job.selected=selected;job.plan=plan;job.revision++;jobs.set(job.id,job);return reply(res,200,response(job)),true;
  }
  const commit=route.match(/^\/api\/institution-imports\/([a-f0-9-]+)\/commit$/);
  if(commit&&req.method==='POST'){
   const input=await body(req),id=commit[1],existing=(getState().imports||[]).find(r=>r.id===id&&r.userId===user.id);
   if(existing)return reply(res,200,{receipt:existing,replayed:true}),true;
   const job=jobFor(id,user),revision=job.revision,plan=job.plan;
   if(input.revision!==revision)throw new RequestError('The preview changed. Review the latest preview before saving.',409);
   if(!plan.summary.ready)throw new RequestError('No valid new rows to import. Correct the file or mapping first.');
   const backupId=await backup();
   const receipt=await transact(next=>{
    const prior=(next.imports||[]).find(r=>r.id===id&&r.userId===user.id);if(prior)return prior;
    if(job.revision!==revision)throw new RequestError('The preview changed. Review it again before saving.',409);
    const current=buildImportPlan(job.selected,plan.mapping,plan.defaultRegion,next.institutions);
    if(current.signature!==plan.signature)throw new RequestError('The directory changed since preview. Refresh the preview and review its rows again.',409);
    const added=current.rows.filter(r=>r.status==='ready'),at=new Date().toISOString();
    for(const {record} of added)next.institutions.push({...record,version:1,importedAt:at,importedBy:user.name,importId:id,provenance:{fileName:job.fileName,sheet:job.selected.sheet,sha256:job.hash,source:record.source,academicYear:record.academicYear}});
    const result={id,userId:user.id,userName:user.name,fileName:job.fileName,sheet:job.selected.sheet,sha256:job.hash,at,added:added.length,skipped:current.rows.length-added.length,institutionIds:added.map(r=>r.record.id),backupId};
    next.imports||=[];next.imports.push(result);return result;
   });
   jobs.delete(id);return reply(res,201,{receipt}),true;
  }
  return false;
 }};
}
