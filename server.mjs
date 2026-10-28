import http from 'node:http';
import {readFile,writeFile,mkdir,open,unlink,rm,readdir,stat,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {seedCases} from './src/domain.mjs';
import {RequestError,object,text,createInput,updateInput,indiaDate,dueDate,BUREAUS} from './src/validation.mjs';
import {openStore} from './src/store.mjs';
import {DEMO_ACCOUNTS,safeUser,verifyPassword,tokenHash,isStaff,directAccess,canRead,canManage,requireManage,visibleCase,connectedIds,canRoute,ROLE_POLICIES} from './src/auth.mjs';
import {semanticPairs,modelInfo} from './src/semantic.mjs';
import {event,notify,notifyCase,runSla} from './src/workflows.mjs';
import {institutionProfiles,normalizeName,caseSummary,sameInstitution} from './src/institutions.mjs';
import {createImportService} from './src/import-service.mjs';
import {createInnovationService,innovationNotifications,assertClosure} from './src/innovation.mjs';
import {openCloudStore,cloudEvidence,cloudBackup} from './src/cloud-store.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const TYPES={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','text/plain':'.txt'};

export async function createApplication({dataDir=path.join(root,'data'),initialCases=seedCases(),scheduler=true,cloudBackend=null,publicOrigin=null,allowedOrigins=[],serverless=false}={}){
 const lockPath=path.join(dataDir,'server.lock');let lock,store;
 if(!cloudBackend){
 await mkdir(dataDir,{recursive:true});
 try{lock=await open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST')throw e;let pid;try{pid=Number(await readFile(lockPath,'utf8'));}catch{}let alive=true;if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('This project already has a running server. Open its existing URL or stop it before restarting.');await unlink(lockPath);lock=await open(lockPath,'wx');}
 await lock.writeFile(String(process.pid));await lock.close();
 }
 const attachmentsDir=path.join(dataDir,'attachments'),backupsDir=path.join(dataDir,'backups');
 if(cloudBackend)store=await openCloudStore(cloudBackend,initialCases);
 else {
 try{await mkdir(attachmentsDir,{recursive:true});await mkdir(backupsDir,{recursive:true});store=await openStore(dataDir,initialCases);}catch(e){await unlink(lockPath);throw e;}
 }
 const assets=cloudBackend?cloudEvidence(cloudBackend):{read:stored=>readFile(path.join(attachmentsDir,path.basename(stored))),write:(stored,bytes)=>writeFile(path.join(attachmentsDir,stored),bytes),remove:stored=>rm(path.join(attachmentsDir,stored),{force:true})};
 let state=store.read(),queue=Promise.resolve();const users=store.users(),streams=new Set();
 const pairKey=p=>[p.a,p.b].sort().join(':');
 function overlapNotifications(next){const known=new Set(next.notifications.map(n=>n.overlapKey).filter(Boolean));for(const p of semanticPairs(next.cases)){const key=pairKey(p);if(next.reviews.some(r=>r.key===key&&r.decision!=='Pending'))continue;const a=next.cases.find(c=>c.id===p.a),b=next.cases.find(c=>c.id===p.b);for(const u of users.filter(u=>isStaff(u)&&(directAccess(u,a)||directAccess(u,b)))){const own=u.id+':'+key;if(known.has(own))continue;notify(next,u.id,directAccess(u,a)?a.id:b.id,p.crossBureau?'Potential Overlapping Cases – Coordination Required':'Similar complaint requires review',p.reason);next.notifications[0].overlapKey=own;known.add(own);}}}
 async function pushChanges(){for(const stream of streams){if(!await session(stream.req)){stream.res.end();streams.delete(stream);}else stream.res.write('event: change\ndata: {}\n\n');}}
 const closeStreams=()=>{for(const stream of streams)stream.res.end();streams.clear();};
 function transact(fn,options){const task=queue.then(async()=>{const next=structuredClone(state);const result=await fn(next);next.institutions=institutionProfiles(next.cases,next.institutions||[]);overlapNotifications(next);innovationNotifications(next,users);await store.save(next,options);state=next;await pushChanges();return result;});queue=task.catch(()=>{});return task;}
 function scopeState(){return {...state,pairs:semanticPairs(state.cases)};}
 if(!cloudBackend)await transact(()=>{});
 else if(Date.now()-(state.cloudSlaCheckedAt||0)>60000){try{await transact(next=>{runSla(next,users);next.cloudSlaCheckedAt=Date.now();});}catch(e){if(e.status!==409)throw e;state=await store.reload();}}
 const lookup=(next,id)=>{const c=next.cases.find(c=>c.id===id);if(!c)throw new RequestError('Case not found.',404);return c;};
 function accessible(user,id,next=scopeState()){const c=lookup(next,id);if(!canRead(user,c,next))throw new RequestError('This case is outside your account access.',403);return c;}
 const admin=u=>{if(u.role!=='Admin')throw new RequestError('Admin access is required.',403);};
 const staff=u=>{if(!isStaff(u))throw new RequestError('Officer access is required.',403);};
 const reply=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
 async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new RequestError('Send JSON content.',415);if(req.body!==undefined){try{return object(typeof req.body==='string'||Buffer.isBuffer(req.body)?JSON.parse(String(req.body)):req.body);}catch(e){if(e instanceof RequestError)throw e;throw new RequestError('Invalid JSON request.');}}let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>7*1024*1024)throw new RequestError('Request too large. Maximum file size is 5 MB.',413);chunks.push(chunk);}try{return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){if(e instanceof RequestError)throw e;throw new RequestError('Invalid JSON request.');}}
 async function session(req){const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('samanvay_session='));if(!cookie)return null;const token=cookie.slice('samanvay_session='.length);if(!/^[a-f0-9]{64}$/.test(token))return null;const s=await store.getSession(tokenHash(token));if(!s||s.expires_at<Date.now())return null;return users.find(u=>u.id===s.user_id);}
 const cookie=(value,age)=>`samanvay_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${publicOrigin?.startsWith('https://')?'; Secure':''}`;
 const attempts=new Map();
 async function login(req,res){
  const b=await body(req),email=text(b.email,'Email',3,200).toLowerCase(),password=text(b.password,'Password',1,200),attempt=attempts.get(email);
  if(cloudBackend?!await store.loginAttempt(email):attempt&&attempt.count>=8&&attempt.until>Date.now())throw new RequestError('Too many failed attempts. Try again in 15 minutes.',429);
  const user=users.find(u=>u.email===email);
  if(!user||!verifyPassword(password,user.passwordHash)){
   if(!cloudBackend){const old=attempt&&attempt.until>Date.now()?attempt:{count:0,until:Date.now()+900000};attempts.set(email,{...old,count:old.count+1});}
   throw new RequestError('Email or password is incorrect.',401);
  }
  if(cloudBackend)await store.loginAttempt(email,true);else attempts.delete(email);
  const prior=req.headers.cookie?.match(/(?:^|;\s*)samanvay_session=([a-f0-9]{64})/),token=randomBytes(32).toString('hex');
  await store.startSession({hash:tokenHash(token),userId:user.id,expiresAt:Date.now()+8*3600000,previous:prior?tokenHash(prior[1]):null});
  return reply(res,200,{user:safeUser(user)},{'Set-Cookie':cookie(token,8*3600)});
 }
 async function backup(){await queue;if(cloudBackend)return cloudBackup(store,structuredClone(state));const id='backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6);const folder=path.join(backupsDir,id);await mkdir(folder);store.db.prepare('VACUUM INTO ?').run(path.join(folder,'samanvay.sqlite'));await cp(attachmentsDir,path.join(folder,'attachments'),{recursive:true});await writeFile(path.join(folder,'manifest.json'),JSON.stringify({id,at:new Date().toISOString(),cases:state.cases.length,includes:'SQLite database, users, sessions, settings and evidence files'},null,2));return id;}
 const importer=createImportService({getState:()=>state,transact,backup,drafts:store.drafts});
 const safeguards=createInnovationService({getState:()=>state,transact,users,body,reply,lookup,scoped:s=>({...s,pairs:semanticPairs(s.cases)}),verifyEvidence:async a=>{let bytes;try{bytes=await assets.read(a.stored);}catch(e){if(e.code==='ENOENT')throw new RequestError('Evidence file is missing. Restore it from a backup before resolution.',409);throw e;}const digest=createHash('sha256').update(bytes).digest('hex');if(a.sha256&&a.sha256!==digest)throw new RequestError('Evidence integrity check failed. Restore the verified file from a backup before resolution.',409);a.sha256=digest;},sendFile:sendEvidence});
 async function sendEvidence(res,a){
  const bytes=await assets.read(a.stored);
  if(a.sha256&&createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw new RequestError('Evidence integrity check failed. Restore the verified file from a backup before use.',409);
  if(cloudBackend){res.writeHead(302,{'Location':await assets.signDownload(a),'Cache-Control':'no-store'});res.end();return;}
  res.writeHead(200,{'Content-Type':a.type,'Content-Disposition':`attachment; filename="evidence${TYPES[a.type]}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(bytes);
 }
 async function listBackups(){if(cloudBackend)return cloudBackend.rpc('samanvay_backup');const list=[];for(const name of await readdir(backupsDir)){if(!/^backup-[\w-]+$/.test(name))continue;try{const meta=JSON.parse(await readFile(path.join(backupsDir,name,'manifest.json'),'utf8'));const size=(await stat(path.join(backupsDir,name,'samanvay.sqlite'))).size;list.push({...meta,size});}catch{}}return list.sort((a,b)=>b.at.localeCompare(a.at));}
 async function tick(){return transact(next=>runSla(next,users));}
 let ticking=false;const timer=scheduler&&!serverless&&!cloudBackend?setInterval(async()=>{if(ticking)return;ticking=true;try{await tick();const list=await listBackups();if(!list.some(b=>indiaDate(new Date(b.at))===indiaDate()))await backup();}catch(e){console.error('Scheduled work failed:',e.message);}finally{ticking=false;}},60000):null;timer?.unref();
 const server=http.createServer(async(req,res)=>{try{
  if(req.headers.origin&&req.headers.origin!==(publicOrigin||`http://${req.headers.host}`)&&!allowedOrigins.includes(req.headers.origin))throw new RequestError('Cross-origin requests are not allowed.',403);
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  if(route==='/api/health'&&req.method==='GET')return reply(res,200,cloudBackend?{app:'samanvay',version:'1.0.0',database:'PostgreSQL',storage:'private-cloud',sessions:'shared'}:{app:'samanvay',version:'1.0.0',project:root,database:'SQLite',dataDirectory:path.resolve(dataDir),pid:process.pid});
  if(route==='/api/config'&&req.method==='GET')return reply(res,200,{cloud:!!cloudBackend,uploadOrigin:cloudBackend?.config.url||null});
  if(route==='/api/runner/stop'&&req.method==='POST'){
   const token=process.env.SAMANVAY_RUNNER_TOKEN;
   if(!token||req.headers['x-samanvay-runner']!==token)throw new RequestError('Launcher authorization required.',403);
   reply(res,200,{ok:true});setImmediate(()=>{closeStreams();server.close(()=>cleanup().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);}));});return;
  }
  if(route==='/api/auth/demo'&&req.method==='GET')return reply(res,200,{accounts:DEMO_ACCOUNTS.map(a=>({...a,authority:ROLE_POLICIES[a.role]})),demo:true});
  if(route==='/api/auth/login'&&req.method==='POST')return await login(req,res);
  if(route==='/api/auth/logout'&&req.method==='POST'){const raw=req.headers.cookie?.match(/(?:^|;\s*)samanvay_session=([a-f0-9]{64})/);if(raw)await store.endSession(tokenHash(raw[1]));return reply(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
  if(route.startsWith('/api/')){
   const user=await session(req);if(!user)throw new RequestError('Please sign in to continue.',401);
   if((route.startsWith('/api/innovation')||route.includes('/safeguards'))&&await safeguards.handle({route,req,res,user}))return;
   if(route.startsWith('/api/institution-imports')){admin(user);if(await importer.handle({route,req,res,user,body,reply}))return;}
   if(route==='/api/events'&&req.method==='GET'){
    if(serverless){res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;}
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 2000\nevent: ready\ndata: {}\n\n');
    const stream={req,res};streams.add(stream);const heartbeat=setInterval(async()=>{try{if(!await session(req))res.end();else res.write(': heartbeat\n\n');}catch{res.end();}},15000);heartbeat.unref();res.on('close',()=>{clearInterval(heartbeat);streams.delete(stream);});return;
   }
   if(route==='/api/uploads/sign'&&req.method==='POST'){
    if(!cloudBackend)throw new RequestError('Direct upload is only used by the cloud deployment.');
    const b=await body(req),c=accessible(user,b.caseId);if(isStaff(user))requireManage(user,c);else if(c.ownerId!==user.id)throw new RequestError('Access denied.',403);
    const name=text(b.name,'File name',1,150);if(/[\u0000-\u001f\u007f]/.test(name)||!name.isWellFormed())throw new RequestError('Choose a valid file name.');
    if(!Object.hasOwn(TYPES,b.type)||!Number.isInteger(b.size)||b.size<1||b.size>5*1024*1024)throw new RequestError('Choose a PDF, PNG, JPEG or TXT file up to 5 MB.');
    if(c.attachments.length>=10)throw new RequestError('Up to 10 attachments per case.');
    return reply(res,200,await assets.prepare({userId:user.id,caseId:c.id,name,type:b.type,size:b.size}));
   }
   if(route==='/api/institutions'&&req.method==='GET'){
    staff(user);const scoped=scopeState(),list=state.cases.filter(c=>canRead(user,c,scoped)),ids=new Set(list.map(c=>c.institutionId));return reply(res,200,{institutions:state.institutions.filter(p=>user.role==='Admin'||ids.has(p.id)||user.role==='Regional Officer'&&p.region===user.region).map(p=>({...p,caseCount:list.filter(c=>c.institutionId===p.id).length,canEdit:user.role==='Admin'||user.role==='Regional Officer'&&p.region===user.region}))});
   }
   const institutionMatch=route.match(/^\/api\/institutions\/([A-Z0-9-]+)$/);
   if(institutionMatch){staff(user);const p=state.institutions.find(p=>p.id===institutionMatch[1]),scoped=scopeState(),list=state.cases.filter(c=>c.institutionId===institutionMatch[1]&&canRead(user,c,scoped));if(!p||!(list.length||user.role==='Admin'||user.role==='Regional Officer'&&p.region===user.region))throw new RequestError('Institution outside your access.',403);
    if(req.method==='GET')return reply(res,200,{institution:p,cases:list.map(c=>({...caseSummary(visibleCase(user,c)),canManage:canManage(user,c)})),history:list.flatMap(c=>c.history.map(h=>({...h,caseId:c.id}))).sort((a,b)=>b.at.localeCompare(a.at)),canEdit:user.role==='Admin'||user.role==='Regional Officer'&&p.region===user.region});
    if(req.method==='PATCH'){
     if(!(user.role==='Admin'||user.role==='Regional Officer'&&p.region===user.region))throw new RequestError('Senior institution authority required.',403);const b=await body(req);const profile=await transact(next=>{const target=next.institutions.find(x=>x.id===p.id);if(b.version!==target.version)throw new RequestError('Institution changed. Refresh before saving.',409);const name=text(b.name,'Institution name',3,200);const aliases=b.aliases===undefined?target.aliases:b.aliases;if(!Array.isArray(aliases)||aliases.length>12||aliases.some(a=>typeof a!=='string'||a.trim().length<3||a.length>200))throw new RequestError('Use up to 12 valid institution aliases.');const fields={name,aliases:[...new Set(aliases.map(a=>a.trim()))]};for(const [key,max] of [['address',500],['city',100],['state',100],['pincode',6],['contact',200]])fields[key]=b[key]===undefined?target[key]||'':b[key]===''?'':text(b[key],key,1,max);if(fields.pincode&&!/^[1-9][0-9]{5}$/.test(fields.pincode))throw new RequestError('Use a valid six-digit PIN code.');Object.assign(target,fields,{version:target.version+1,updatedAt:new Date().toISOString(),updatedBy:user.name});for(const c of next.cases.filter(c=>c.institutionId===p.id)){c.institution=name;event(c,'Institution profile updated by '+user.name,user,'internal');}return target;});return reply(res,200,{institution:profile});
    }
   }
   if(route==='/api/admin/access'&&req.method==='GET'){admin(user);return reply(res,200,{accounts:users.map(u=>({...safeUser(u),managedCases:state.cases.filter(c=>directAccess(u,c)).length})),hierarchy:ROLE_POLICIES});}
   if(route==='/api/auth/me'&&req.method==='GET')return reply(res,200,{user:safeUser(user),staff:isStaff(user)?users.filter(isStaff).map(safeUser):[],model:modelInfo});
   if(route==='/api/cases'&&req.method==='GET'){const scoped=scopeState(),list=state.cases.filter(c=>canRead(user,c,scoped));const ids=new Set(list.map(c=>c.id));return reply(res,200,{cases:list.map(c=>({...caseSummary(visibleCase(user,c)),canManage:canManage(user,c)})),related:isStaff(user)?scoped.pairs.filter(p=>ids.has(p.a)&&ids.has(p.b)):[],reviews:isStaff(user)?state.reviews.filter(r=>ids.has(r.a)&&ids.has(r.b)):[],notifications:state.notifications.filter(n=>n.userId===user.id),settings:isStaff(user)?state.settings:undefined,model:modelInfo});}
   if(route==='/api/cases'&&req.method==='POST'){
    const input=createInput(await body(req));if(user.role==='Bureau Officer')input.bureau=user.bureau;if(user.role==='Regional Officer'){input.region=user.region;input.bureau='Regional Office';}const result=await transact(next=>{const institution=next.institutions.find(p=>p.id===input.institutionId);if(institution){if(user.role==='Regional Officer'&&institution.region!==user.region)throw new RequestError('This institution belongs to a different region.',403);if(![institution.name,...institution.aliases].some(n=>normalizeName(n)===normalizeName(input.institution)))throw new RequestError('This Permanent ID is registered as '+institution.name+'. Use its canonical name or a recorded alias.');input.institution=institution.name;input.region=institution.region;}const now=new Date();const c={...input,id:'CASE-'+randomUUID().slice(0,8).toUpperCase(),ownerId:user.role==='Complainant'?user.id:'student',status:'New',officer:'Unassigned',version:1,attachments:[],messages:[],notes:[],tasks:[],transfers:[],slaEvents:[],createdAt:now.toISOString(),dueDate:indiaDate(new Date(+now+next.settings.slaDays[input.priority]*86400000)),history:[{at:now.toISOString(),action:'Complaint registered and routed to '+input.bureau,actor:user.name,visibility:'public',actorId:user.id,bureau:input.bureau,role:user.role}]};next.cases.unshift(c);notifyCase(next,users,c,'Complaint registered',`${c.id}: ${c.title}`,{exclude:user.id});return c;});return reply(res,201,{...caseSummary(visibleCase(user,result)),canManage:canManage(user,result)});
   }
   const match=route.match(/^\/api\/cases\/(CASE-[A-Z0-9-]+)(?:\/(messages|feedback|coordination|tasks|attachments|transfers)(?:\/([a-f0-9-]+))?)?$/);
   if(match){const [,id,action,itemId]=match;accessible(user,id);
    if(!action&&req.method==='PATCH'){
     staff(user);const b=await body(req);const result=await transact(next=>{const c=lookup(next,id);requireManage(user,c);const {changes,action}=updateInput(b,c);if(!canRoute(user,c)&&['bureau','priority','dueDate'].some(k=>Object.hasOwn(changes,k)))throw new RequestError('Only Admin or the responsible Regional Officer can change routing, priority or deadlines. Use a transfer request for a bureau change.',403);if(changes.officer&&changes.officer!=='Unassigned'){const assignee=users.find(u=>u.name===changes.officer&&isStaff(u));if(!assignee||(!canRoute(user,c)&&assignee.bureau!==c.bureau&&assignee.id!==user.id))throw new RequestError('Choose an officer within your assignment authority.',403);}if(changes.status==='Resolved'){if(['bureau','priority','dueDate','officer'].some(k=>Object.hasOwn(changes,k)))throw new RequestError('Save routing, officer and deadline changes before completing Resolution Proof Check.',409);assertClosure(next,c);}Object.assign(c,changes);if(changes.status==='Resolved'){c.resolvedAt=new Date().toISOString();c.nextAction='';}else if(changes.status)delete c.resolvedAt;event(c,action,user);notifyCase(next,users,c,'Complaint updated',`${c.id}: ${action}`,{exclude:user.id});return c;});return reply(res,200,{...caseSummary(visibleCase(user,result)),canManage:canManage(user,result)});
    }
    if(action==='transfers'&&!itemId&&req.method==='POST'){
     staff(user);const b=await body(req);if(!BUREAUS.includes(b.bureau))throw new RequestError('Choose a valid destination bureau.');const note=text(b.note,'Transfer reason',10,1500);const result=await transact(next=>{const c=lookup(next,id);requireManage(user,c);if(c.bureau===b.bureau)throw new RequestError('Choose a different bureau.');if(c.transfers.some(t=>t.status==='Pending'))throw new RequestError('A transfer request is already awaiting senior review.',409);const transfer={id:randomUUID(),from:c.bureau,to:b.bureau,note,status:'Pending',requestedBy:user.name,at:new Date().toISOString()};c.transfers.push(transfer);event(c,'Transfer requested to '+b.bureau+'. '+note,user,'internal');for(const senior of users.filter(u=>canRoute(u,c)))notify(next,senior.id,id,'Transfer approval required',`${c.id}: ${c.bureau} → ${b.bureau}`);return transfer;});return reply(res,201,result);
    }
    if(action==='transfers'&&itemId&&req.method==='PATCH'){
     const b=await body(req);if(!['Approved','Rejected'].includes(b.decision))throw new RequestError('Choose an approval decision.');const note=text(b.note,'Decision note',10,1500);const result=await transact(next=>{const c=lookup(next,id);if(!canRoute(user,c))throw new RequestError('Senior approval is required for a transfer decision.',403);const transfer=c.transfers.find(t=>t.id===itemId);if(!transfer)throw new RequestError('Transfer request not found.',404);if(transfer.status!=='Pending')throw new RequestError('This transfer has already been reviewed.',409);transfer.status=b.decision;transfer.reviewedBy=user.name;transfer.reviewedAt=new Date().toISOString();transfer.decisionNote=note;if(b.decision==='Approved'){if(c.bureau!==transfer.from)throw new RequestError('The case has moved since this request. Refresh and review its current desk.',409);c.bureau=transfer.to;c.officer='Unassigned';c.nextAction='';}event(c,`Transfer ${b.decision.toLowerCase()}: ${transfer.from} → ${transfer.to}. ${note}`,user,b.decision==='Approved'?'public':'internal');notifyCase(next,users,c,'Transfer '+b.decision.toLowerCase(),`${c.id}: ${transfer.from} → ${transfer.to}`);return transfer;});return reply(res,200,result);
    }
    if(action==='messages'&&req.method==='POST'){
     const b=await body(req),message=text(b.message,'Message',5,3000);const result=await transact(next=>{const c=lookup(next,id);if(isStaff(user))requireManage(user,c);else if(c.ownerId!==user.id)throw new RequestError('You can only reply on your complaints.',403);if(c.status==='Resolved')throw new RequestError('Use resolution feedback to reopen this complaint before sending a new message.');const clarification=isStaff(user)&&b.type==='clarification';const m={id:randomUUID(),text:message,at:new Date().toISOString(),sender:user.name,role:user.role,type:clarification?'clarification':'reply'};c.messages.push(m);if(clarification)c.status='Awaiting response';else if(!isStaff(user)&&c.status==='Awaiting response')c.status='In progress';event(c,clarification?'Officer requested clarification.':`${user.role==='Complainant'?'Complainant':'Officer'} added a reply.`,user);notifyCase(next,users,c,clarification?'Clarification needed':'New case message',message,{exclude:user.id});return m;});return reply(res,201,result);
    }
    if(action==='feedback'&&req.method==='POST'){
     if(user.role!=='Complainant')throw new RequestError('Feedback is available to the complainant.',403);const b=await body(req);if(!Number.isInteger(b.rating)||b.rating<1||b.rating>5||typeof b.reopen!=='boolean')throw new RequestError('Choose a rating between 1 and 5.');const comment=text(b.comment,'Feedback',10,2000);const result=await transact(next=>{const c=lookup(next,id);if(c.ownerId!==user.id)throw new RequestError('Access denied.',403);if(c.status!=='Resolved')throw new RequestError('Feedback is available after resolution.',409);c.feedback={rating:b.rating,comment,at:new Date().toISOString()};if(b.reopen){c.status='In progress';delete c.resolvedAt;c.dueDate=indiaDate(new Date(Date.now()+next.settings.slaDays[c.priority]*86400000));}event(c,b.reopen?'Complainant requested reopening: '+comment:'Resolution feedback submitted.',user);notifyCase(next,users,c,b.reopen?'Complaint reopened':'Resolution feedback',comment,{owner:false});return c.feedback;});return reply(res,200,result);
    }
    if(action==='coordination'&&req.method==='POST'){
     staff(user);const b=await body(req);const result=await transact(next=>{const c=lookup(next,id);requireManage(user,c);if(b.kind==='note'){const note={id:randomUUID(),text:text(b.note,'Internal note',5,3000),at:new Date().toISOString(),author:user.name};c.notes.push(note);event(c,'Internal coordination note added.',user,'internal');return note;}if(b.kind==='lead'){if(!canRoute(user,c)||connectedIds(next.cases,next.reviews,id).some(key=>!canRoute(user,lookup(next,key))))throw new RequestError('Only Admin or a Regional Officer responsible for the whole group can appoint its lead.',403);const lead=users.find(u=>u.id===b.userId&&isStaff(u));if(!lead)throw new RequestError('Choose an officer.');for(const target of connectedIds(next.cases,next.reviews,id).map(id=>lookup(next,id))){target.leadOfficerId=lead.id;event(target,'Coordination lead assigned: '+lead.name,user,'internal');}notify(next,lead.id,id,'Coordination lead assigned',`You are leading the linked group for ${id}.`);return {ok:true};}throw new RequestError('Choose a valid coordination action.');});return reply(res,201,result);
    }
    if(action==='tasks'&&req.method==='POST'){
     staff(user);const b=await body(req);const result=await transact(next=>{const c=lookup(next,id);requireManage(user,c);const assigned=users.find(u=>u.id===b.assignedTo&&isStaff(u));if(!assigned)throw new RequestError('Choose an officer.');const date=dueDate(b.dueDate);if(date<indiaDate())throw new RequestError('Task deadline cannot be in the past.');const task={id:randomUUID(),title:text(b.title,'Task',5,200),assignedTo:assigned.id,assignedName:assigned.name,dueDate:date,status:'Open',at:new Date().toISOString(),author:user.name};c.tasks.push(task);event(c,'Coordination task created: '+task.title,user,'internal');notify(next,assigned.id,id,'New coordination task',task.title);return task;});return reply(res,201,result);
    }
    if(action==='tasks'&&itemId&&req.method==='PATCH'){
     staff(user);const b=await body(req);if(!['Open','Done'].includes(b.status))throw new RequestError('Choose a task status.');const task=await transact(next=>{const c=lookup(next,id),t=c.tasks.find(t=>t.id===itemId);if(!t)throw new RequestError('Task not found.',404);if(!canManage(user,c)&&t.assignedTo!==user.id)throw new RequestError('Only the task assignee or managing desk can update it.',403);t.status=b.status;event(c,`Task ${b.status.toLowerCase()}: ${t.title}`,user,'internal');return t;});return reply(res,200,task);
    }
    if(action==='attachments'&&!itemId&&req.method==='POST'){
     const b=await body(req),current=lookup(state,id);if(isStaff(user))requireManage(user,current);else if(current.ownerId!==user.id)throw new RequestError('Access denied.',403);
     const uploaded=cloudBackend&&b.uploadTicket?await assets.consume(b.uploadTicket,user.id,id):null;
     const name=text(uploaded?.name??b.name,'File name',1,150),type=uploaded?.type??b.type;
     if(typeof type!=='string'||!Object.hasOwn(TYPES,type))throw new RequestError('Upload a PDF, PNG, JPEG or TXT file.');
     if(/[\u0000-\u001f\u007f]/.test(name)||!name.isWellFormed())throw new RequestError('Choose a valid file name.');
     if(!uploaded&&(typeof b.content!=='string'||!b.content.length||b.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.content)))throw new RequestError('Invalid file encoding.');
     const bytes=uploaded?uploaded.bytes:Buffer.from(b.content,'base64');if(!bytes.length||bytes.length>5*1024*1024)throw new RequestError('File must be between 1 byte and 5 MB.',413);
     const signatures={'application/pdf':()=>bytes.subarray(0,5).toString()==='%PDF-','image/png':()=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':()=>bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'text/plain':()=>!bytes.includes(0)};
     if(!signatures[type]())throw new RequestError('File contents do not match its type.');
     const stored=randomUUID()+TYPES[type];await assets.write(stored,bytes,type);
     try{
      const result=await transact(next=>{const c=lookup(next,id);if(isStaff(user))requireManage(user,c);else if(c.ownerId!==user.id)throw new RequestError('Access denied.',403);if(c.attachments.length>=10)throw new RequestError('Up to 10 attachments per case.');const a={id:randomUUID(),name,type,size:bytes.length,stored,at:new Date().toISOString(),visibility:'public',sha256:createHash('sha256').update(bytes).digest('hex'),uploadedBy:user.name,uploadedById:user.id};c.attachments.push(a);event(c,'Evidence attached: '+name,user);return {id:a.id,name:a.name};});
      if(uploaded)try{await assets.discardPending(uploaded.pending);}catch{console.error('Pending upload cleanup deferred.');}
      return reply(res,201,result);
     }catch(e){if(!e.commitUncertain)try{await assets.remove(stored);}catch{console.error('Uncommitted evidence cleanup deferred.');}throw e;}
    }
    if(action==='attachments'&&itemId&&req.method==='GET'){const c=lookup(state,id),a=c.attachments.find(a=>a.id===itemId);if(!a||(!isStaff(user)&&a.visibility==='internal'))throw new RequestError('Attachment not found.',404);await sendEvidence(res,a);return;}
   }
   if(route==='/api/reviews'&&req.method==='POST'){
    staff(user);const b=await body(req);accessible(user,b.a);accessible(user,b.b);if(!canManage(user,lookup(state,b.a))&&!canManage(user,lookup(state,b.b)))throw new RequestError('Only a responsible desk can review this pair.',403);if(!['Linked','Dismissed','Pending'].includes(b.decision))throw new RequestError('Choose a valid review action.');const note=text(b.note,'Review note',10,1000);const result=await transact(next=>{if(b.a===b.b)throw new RequestError('Choose different cases.');const key=[b.a,b.b].sort().join(':'),existing=next.reviews.find(r=>r.key===key);if((b.version??0)!==(existing?.version??0))throw new RequestError('Review changed. Refresh before saving.',409);if(!existing&&!sameInstitution(lookup(next,b.a),lookup(next,b.b)))throw new RequestError('Only cases belonging to the same institution can be mapped.',400);const r={key,a:b.a,b:b.b,decision:b.decision,note,at:new Date().toISOString(),version:(existing?.version??0)+1};next.reviews=next.reviews.filter(x=>x.key!==key);next.reviews.push(r);for(const id of [b.a,b.b])event(lookup(next,id),`Related-case review: ${b.decision} (${id===b.a?b.b:b.a}). ${note}`,user,'internal');return r;});return reply(res,200,result);
   }
   if(route==='/api/notifications/read'&&req.method==='POST'){const b=await body(req);await transact(next=>{for(const n of next.notifications)if(n.userId===user.id&&(!b.id||b.id===n.id))n.read=true;});return reply(res,200,{ok:true});}
   if(route==='/api/settings'&&req.method==='PATCH'){admin(user);const b=await body(req);for(const key of ['High','Medium','Low'])if(!Number.isInteger(b.slaDays?.[key])||b.slaDays[key]<1||b.slaDays[key]>60)throw new RequestError('SLA days must be integers from 1 to 60.');if(!Number.isInteger(b.remindBeforeDays)||b.remindBeforeDays<0||b.remindBeforeDays>14||!Number.isInteger(b.escalateAfterDays)||b.escalateAfterDays<0||b.escalateAfterDays>14)throw new RequestError('Reminder and escalation days must be from 0 to 14.');await transact(next=>{next.settings={slaDays:b.slaDays,remindBeforeDays:b.remindBeforeDays,escalateAfterDays:b.escalateAfterDays};});return reply(res,200,{settings:state.settings});}
   if(route==='/api/sla/run'&&req.method==='POST'){admin(user);return reply(res,200,{events:await tick()});}
   if(route==='/api/backups'&&req.method==='GET'){admin(user);return reply(res,200,{backups:await listBackups()});}
   if(route==='/api/backups'&&req.method==='POST'){admin(user);return reply(res,201,{id:await backup()});}
   const download=route.match(/^\/api\/backups\/(backup-[\w-]+)$/);if(download&&req.method==='GET'){admin(user);if(cloudBackend){const meta=await cloudBackend.rpc('samanvay_backup',{p_id:download[1]});if(!meta)throw new RequestError('Backup not found.',404);const bytes=await cloudBackend.read(meta.object);if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new RequestError('Backup integrity check failed.',409);res.writeHead(302,{'Location':await cloudBackend.signDownload(meta.object,meta.id+'.json.gz'),'Cache-Control':'no-store'});res.end();return;}const bytes=await readFile(path.join(backupsDir,download[1],'samanvay.sqlite'));res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="${download[1]}.sqlite"`,'Cache-Control':'no-store'});return res.end(bytes);}
   throw new RequestError('Endpoint or method not found.',404);
  }
  if(!['GET','HEAD'].includes(req.method))throw new RequestError('Method not allowed.',405);const file={'/':'index.html','/app.js':'app.js','/roles.js':'roles.js','/styles.css':'styles.css','/designs.css':'designs.css','/insights.js':'insights.js','/requirements.js':'requirements.js','/import.js':'import.js','/safeguards.js':'safeguards.js','/uploads.js':'uploads.js'}[route];if(!file)throw new RequestError('Page not found.',404);res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' ${cloudBackend?.config.url||''}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`});res.end(req.method==='HEAD'?undefined:await readFile(path.join(root,'public',file)));
 }catch(e){if(!res.headersSent)reply(res,e.status||500,{error:e.status?e.message:'Unable to complete this action. Your saved data is preserved; please try again.'});else res.end();if(!e.status)console.error(e);}});
 const cleanup=async()=>{closeStreams();if(timer)clearInterval(timer);await queue;await store.close();if(!cloudBackend)await rm(lockPath,{force:true});};return {server,cleanup,tick,backup,listBackups,closeStreams};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const {server,cleanup,closeStreams}=await createApplication({dataDir:process.env.SAMANVAY_DATA_DIR||path.join(root,'data')});let port=Number(process.env.SAMANVAY_PORT||3000);const lastPort=Math.min(port+20,65535);server.on('error',e=>{if(e.code==='EADDRINUSE'&&port<lastPort){console.log(`Port ${port} busy. Trying ${++port}...`);server.listen(port,'127.0.0.1');}else{console.error('Unable to start: '+e.message);cleanup().finally(()=>process.exit(1));}});server.on('listening',()=>console.log(`Samanvay running at http://127.0.0.1:${port}`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closeStreams();server.close(()=>cleanup().finally(()=>process.exit(0)));});server.listen(port,'127.0.0.1');}catch(e){console.error(e.message);process.exitCode=1;}
}
