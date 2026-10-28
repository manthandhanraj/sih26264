import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudConfig,createCloudBackend} from '../src/cloud-store.mjs';
import {institutionProfiles} from '../src/institutions.mjs';
import {DEFAULT_SETTINGS} from '../src/store.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function migrateToSupabase({backend=createCloudBackend(cloudConfig()),dataDirectory=process.env.SAMANVAY_DATA_DIR||path.join(root,'data')}={}){
 const data=path.resolve(dataDirectory);
 if(await backend.rpc('samanvay_open'))throw Error('Cloud casework is already initialized. Migration stopped without replacing it. Use a new empty Supabase project for this migration.');
 const db=new DatabaseSync(path.join(data,'samanvay.sqlite'),{readOnly:true});let state,users;
 try{
  db.exec('BEGIN');
  if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('Local database integrity check failed.');
  const rows=table=>db.prepare('SELECT payload FROM '+table+' ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));
  const meta=(key,fallback)=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||JSON.stringify(fallback));
  const cases=rows('cases').map(c=>({...c,transfers:c.transfers||[]}));
  state={cases,institutions:institutionProfiles(cases,rows('institutions')),reviews:rows('reviews'),notifications:rows('notifications'),imports:rows('institution_imports'),innovation:meta('innovation',{passports:[],policyRuns:[]}),settings:meta('settings',DEFAULT_SETTINGS)};
  users=db.prepare('SELECT payload,password_hash FROM users').all().map(r=>({...JSON.parse(r.payload),passwordHash:r.password_hash}));db.exec('COMMIT');
 }finally{db.close();}
 const folder=path.join(data,'backups','cloud-migration-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,'before-migration.json'),JSON.stringify({format:'samanvay-local-export-v1',state,users},null,2));
 // Source attachments are immutable. Assign separate cloud names so retries
 // never overwrite existing objects. Do not remove objects after an ambiguous
 // network result: the database may already reference them.
 let uploaded=0;
 for(const c of state.cases)for(const a of c.attachments||[]){
  const old=path.basename(a.stored);if(old!==a.stored||!/\.(pdf|png|jpg|txt)$/.test(old))throw Error('An evidence path needs review before migration.');
  const bytes=await readFile(path.join(data,'attachments',old)),digest=createHash('sha256').update(bytes).digest('hex');
  if(a.sha256&&a.sha256!==digest)throw Error('An evidence integrity check failed. Local records were not changed.');
  a.stored=randomUUID()+path.extname(old);a.sha256=digest;await backend.write('evidence/'+a.stored,bytes,a.type);uploaded++;
 }
 const published=await backend.rpc('samanvay_open',{p_seed:state,p_users:users});
 if(JSON.stringify(published.state)!==JSON.stringify(state)){
  // PostgreSQL JSONB may reorder object keys; compare normalized JSON below.
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  if(JSON.stringify(canonical(published.state))!==JSON.stringify(canonical(state)))throw Error('Cloud casework was initialized concurrently. No existing cloud casework was replaced.');
 }
 return {cases:state.cases.length,institutions:state.institutions.length,accounts:users.length,evidenceFiles:uploaded};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await migrateToSupabase();console.log(`Migration completed: ${result.cases} complaints, ${result.institutions} institutions, ${result.accounts} accounts and ${result.evidenceFiles} evidence files.`);console.log('Local database/evidence were preserved. A private before-migration export is under data/backups/. Sign in again on the cloud site.');}
 catch(e){console.error('Migration stopped: '+e.message);process.exitCode=1;}
}
