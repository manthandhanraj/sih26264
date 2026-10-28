import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {DEMO_ACCOUNTS,hashPassword,tokenHash} from './auth.mjs';
import {RequestError} from './validation.mjs';
import {institutionProfiles} from './institutions.mjs';
import {DEFAULT_SETTINGS} from './store.mjs';

export function cloudConfig(env=process.env){
 const missing=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SAMANVAY_PUBLIC_URL'].filter(k=>!env[k]);
 if(missing.length)throw new RequestError('Cloud setup is incomplete. Set '+missing.join(', ')+' in Vercel and redeploy.',503);
 let url,origin;try{url=new URL(env.SUPABASE_URL);origin=new URL(env.SAMANVAY_PUBLIC_URL);}catch{throw new RequestError('Cloud URLs must be valid HTTPS URLs.',503);}
 if(url.protocol!=='https:'||origin.protocol!=='https:'||url.username||url.password||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new RequestError('Cloud URLs must use HTTPS, and SAMANVAY_PUBLIC_URL must be the site origin only.',503);
 const origins=new Set([origin.origin]);
 // Trust only deployment names supplied by the hosting environment, never a
 // request's Host/X-Forwarded-* headers or a wildcard for all vercel.app sites.
 for(const name of ['VERCEL_URL','VERCEL_BRANCH_URL','VERCEL_PROJECT_PRODUCTION_URL']){const host=env[name];if(host&&/^[a-z0-9][a-z0-9.-]+\.vercel\.app$/i.test(host))origins.add(new URL('https://'+host).origin);}
 return {url:url.origin,key:env.SUPABASE_SERVICE_ROLE_KEY,origin:origin.origin,origins:[...origins],bucket:env.SUPABASE_STORAGE_BUCKET||'samanvay-private'};
}
export function createCloudBackend(config,{fetchImpl=fetch}={}){
 const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)})}});
 const bucket=client.storage.from(config.bucket);
 const checked=async promise=>{let result;try{result=await promise;}catch{throw new RequestError('Cloud service is temporarily unavailable. Retry in a moment.',503);}if(result.error){console.error('Cloud operation failed:',result.error.code||result.error.statusCode||'provider-error');if(['PGRST202','PGRST205','42883','42P01'].includes(result.error.code))throw new RequestError('Supabase setup is incomplete. Run the entire supabase/setup.sql, including COMMIT and the final API cache refresh. The result should show 11 app functions and a private bucket.',503);throw new RequestError('Cloud database or private storage is not ready. Check the Supabase setup and server logs.',503);}return result.data;};
 return {
  config, rpc:(name,parameters={})=>checked(client.rpc(name,parameters)),
  async checkBucket(){const info=await checked(client.storage.getBucket(config.bucket));if(info.public!==false||Number(info.file_size_limit)!==5*1024*1024)throw new RequestError('Evidence bucket must be private with the 5 MB limit from supabase/setup.sql.',503);},
  async read(key){const data=await checked(bucket.download(key));return Buffer.from(await data.arrayBuffer());},
  async write(key,bytes,type='application/octet-stream'){await checked(bucket.upload(key,bytes,{contentType:type,upsert:false}));},
  async remove(key){await checked(bucket.remove([key]));},
  async copy(source,target){await checked(bucket.copy(source,target));},
  async signUpload(key){return checked(bucket.createSignedUploadUrl(key,{upsert:false}));},
  async signDownload(key,name){const data=await checked(bucket.createSignedUrl(key,60,{download:name}));return data.signedUrl;},
  async cleanPending(){for(let offset=0;;){const list=await checked(bucket.list('pending',{limit:100,offset,sortBy:{column:'created_at',order:'asc'}}));if(!list.length)break;const old=list.filter(x=>x.id&&Date.parse(x.created_at)<Date.now()-130*60000);if(old.length)await checked(bucket.remove(old.map(x=>'pending/'+x.name)));offset+=list.length-old.length;if(list.length<100)break;}},
 };
}
export function initialCloudState(cases){
 const rows=structuredClone(cases).map(c=>({...c,version:c.version||1,attachments:c.attachments||[],ownerId:c.ownerId||(c.category==='Faculty grievance'?'faculty':'student'),messages:c.messages||[],notes:c.notes||[],tasks:c.tasks||[],transfers:c.transfers||[],slaEvents:c.slaEvents||[]}));
 return {cases:rows,institutions:institutionProfiles(rows),reviews:[],notifications:[],imports:[],innovation:{passports:[],policyRuns:[]},settings:structuredClone(DEFAULT_SETTINGS)};
}
export async function openCloudStore(backend,cases){
 let snapshot=await backend.rpc('samanvay_open');
 if(!snapshot){const users=DEMO_ACCOUNTS.map(({password,...u})=>({...u,passwordHash:hashPassword(password)}));snapshot=await backend.rpc('samanvay_open',{p_seed:initialCloudState(cases),p_users:users});}
 if(!snapshot||!Number.isSafeInteger(snapshot.revision)||!Array.isArray(snapshot.state?.cases)||!Array.isArray(snapshot.users))throw new RequestError('Cloud snapshot is unavailable. Check the database setup.',503);
 let revision=snapshot.revision;
 return {
  cloud:true,backend,read:()=>structuredClone(snapshot.state),users:()=>structuredClone(snapshot.users),close:async()=>{},
  async reload(){snapshot=await backend.rpc('samanvay_open');revision=snapshot.revision;return structuredClone(snapshot.state);},
  async save(state,{draft}={}){let ok;try{ok=await backend.rpc('samanvay_save',{p_revision:revision,p_state:state,p_draft_id:draft?.id||null,p_draft_revision:draft?.revision??null,p_draft_user:draft?.userId||null});}catch{const e=new RequestError('Cloud confirmation was interrupted. Refresh to check whether the change saved before retrying.',503);e.commitUncertain=true;throw e;}if(!ok)throw new RequestError('The workspace or import preview changed in another session. Refresh and retry; your edit was not saved.',409);revision++;snapshot={...snapshot,revision,state:structuredClone(state)};},
  getSession:hash=>backend.rpc('samanvay_get_session',{p_hash:hash}),
  startSession:({hash,userId,expiresAt,previous})=>backend.rpc('samanvay_start_session',{p_hash:hash,p_user:userId,p_expires:expiresAt,p_previous:previous||null}),
  endSession:hash=>backend.rpc('samanvay_end_session',{p_hash:hash}),
  loginAttempt:(email,reset=false)=>backend.rpc('samanvay_login_attempt',{p_email_hash:tokenHash(email),p_reset:reset}),
  drafts:{
   get:(id,user)=>backend.rpc('samanvay_get_draft',{p_id:id,p_user:user}),
   async put(job,expected){if(!await backend.rpc('samanvay_put_draft',{p_id:job.id,p_user:job.userId,p_payload:job,p_expected:expected}))throw new RequestError('The import preview changed in another session. Reload it before saving.',409);},
   delete:(id,user)=>backend.rpc('samanvay_delete_draft',{p_id:id,p_user:user}),
  },
 };
}

export function cloudEvidence(backend){
 const secret=createHash('sha256').update('samanvay:upload-ticket:'+backend.config.key).digest();
 const mac=value=>createHmac('sha256',secret).update(value).digest('base64url');
 const key=stored=>{if(!/^[a-f0-9-]+\.(?:pdf|png|jpg|txt)$/.test(stored))throw new RequestError('Invalid evidence reference.',400);return 'evidence/'+stored;};
 return {
  cloud:true,read:stored=>backend.read(key(stored)),write:(stored,bytes,type)=>backend.write(key(stored),bytes,type),remove:stored=>backend.remove(key(stored)),
  async signDownload(a){return backend.signDownload(key(a.stored),a.name);},
  async prepare({userId,caseId,name,type,size}){const pending='pending/'+randomUUID(),payload=Buffer.from(JSON.stringify({pending,userId,caseId,name,type,size,expires:Date.now()+15*60000})).toString('base64url');const upload=await backend.signUpload(pending);return {signedUrl:upload.signedUrl,uploadTicket:payload+'.'+mac(payload),method:'PUT'};},
  async consume(ticket,userId,caseId){
   if(typeof ticket!=='string'||ticket.length>4096)throw new RequestError('Invalid upload ticket.',400);
   const [payload,signature,...extra]=ticket.split('.'),expected=mac(payload||''),a=Buffer.from(signature||''),b=Buffer.from(expected);
   if(extra.length||a.length!==b.length||!timingSafeEqual(a,b))throw new RequestError('Invalid upload ticket.',403);
   let value;try{value=JSON.parse(Buffer.from(payload,'base64url'));}catch{throw new RequestError('Invalid upload ticket.',400);}
   if(value.userId!==userId||value.caseId!==caseId||value.expires<Date.now()||!/^pending\/[a-f0-9-]+$/.test(value.pending))throw new RequestError('Upload expired or belongs to another case/account. Choose the file again.',403);
   const bytes=await backend.read(value.pending);
   if(bytes.length!==value.size||bytes.length>5*1024*1024)throw new RequestError('Uploaded file size differs from the approved upload.',400);
   return {...value,bytes};
  },
  async discardPending(pending){await backend.remove(pending);},
 };
}
export async function cloudBackup(store,state){
 const backend=store.backend,id='backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6);
 const attachments=[...new Map(state.cases.flatMap(c=>c.attachments||[]).map(a=>[a.stored,a])).values()],files=[];
 for(const a of attachments){const target=id+'/evidence/'+a.stored;await backend.copy('evidence/'+a.stored,'backups/'+target);files.push({stored:a.stored,key:'backups/'+target,sha256:a.sha256||null});}
 const snapshot={format:'samanvay-cloud-backup-v1',at:new Date().toISOString(),state,users:store.users(),files,sessionsIncluded:false};
 const bytes=gzipSync(Buffer.from(JSON.stringify(snapshot))),object='backups/'+id+'/snapshot.json.gz';
 await backend.write(object,bytes,'application/gzip');
 const manifest={id,at:snapshot.at,cases:state.cases.length,size:bytes.length,format:'cloud-json-gzip',object,sha256:createHash('sha256').update(bytes).digest('hex'),evidenceFiles:files.length,includes:'Casework, hashed user records and private evidence copies; active sessions excluded'};
 await backend.rpc('samanvay_backup',{p_id:id,p_manifest:manifest});return id;
}
