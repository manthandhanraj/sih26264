import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {DEMO_ACCOUNTS,hashPassword} from './auth.mjs';
import {institutionProfiles} from './institutions.mjs';
export const DEFAULT_SETTINGS={slaDays:{High:3,Medium:7,Low:14},remindBeforeDays:2,escalateAfterDays:1};
export async function openStore(dataDir,initialCases){
 await mkdir(dataDir,{recursive:true});const db=new DatabaseSync(path.join(dataDir,'samanvay.sqlite'));db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,owner_id TEXT,bureau TEXT,region TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS cases_owner ON cases(owner_id);CREATE INDEX IF NOT EXISTS cases_bureau ON cases(bureau);
 CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS institution_imports(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 `);
 if(!db.prepare("SELECT value FROM meta WHERE key='initialized'").get()){
  let legacy;try{legacy=JSON.parse(await readFile(path.join(dataDir,'cases.json'),'utf8'));}catch(e){if(e.code!=='ENOENT'){db.close();throw Error('Existing JSON data could not be read; migration stopped without changing it.');}}
  const imported=legacy?(Array.isArray(legacy)?{cases:legacy,reviews:[]}:legacy):{cases:initialCases,reviews:[]};
  if(!Array.isArray(imported.cases)||!Array.isArray(imported.reviews)){db.close();throw Error('Saved data format is invalid. Migration stopped.');}
  const state={cases:imported.cases.map((c,i)=>({...c,version:c.version||1,attachments:c.attachments||[],ownerId:c.ownerId||(c.category==='Faculty grievance'?'faculty':'student'),messages:c.messages||[],notes:c.notes||[],tasks:c.tasks||[],slaEvents:c.slaEvents||[]})),reviews:imported.reviews,notifications:[],settings:DEFAULT_SETTINGS};
  save(state);db.prepare("INSERT INTO meta(key,value) VALUES('initialized','1')").run();
 }
 for(const a of DEMO_ACCOUNTS){if(!db.prepare('SELECT id FROM users WHERE id=?').get(a.id)){const {password,...u}=a;db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(a.id,a.email,hashPassword(password),JSON.stringify(u));}}
 // Rename the existing demo identities without resetting passwords or sessions.
 const accountRenames=[{id:'admin',from:'Aditi Sharma',to:'Sakshi Sharma'},{id:'regional',from:'Neha Singh',to:'Nidhi Singh'}];
 db.exec('BEGIN IMMEDIATE');try{
  for(const rename of accountRenames){const row=db.prepare('SELECT payload FROM users WHERE id=?').get(rename.id);if(row){const user=JSON.parse(row.payload);if(user.name===rename.from){user.name=rename.to;db.prepare('UPDATE users SET payload=? WHERE id=?').run(JSON.stringify(user),rename.id);}}}
  for(const row of db.prepare('SELECT id,payload FROM cases').all()){const c=JSON.parse(row.payload);let changed=false;for(const rename of accountRenames){if(c.officer===rename.from){c.officer=rename.to;changed=true;}for(const task of c.tasks||[])if(task.assignedTo===rename.id&&task.assignedName===rename.from){task.assignedName=rename.to;changed=true;}}if(changed){c.version=(c.version||1)+1;db.prepare('UPDATE cases SET payload=? WHERE id=?').run(JSON.stringify(c),row.id);}}
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');db.close();throw e;}
 function read(){const cases=db.prepare('SELECT payload FROM cases ORDER BY rowid DESC').all().map(x=>{const c=JSON.parse(x.payload);return {...c,transfers:c.transfers||[]};});return {cases,innovation:JSON.parse(db.prepare("SELECT value FROM meta WHERE key='innovation'").get()?.value||'{"passports":[],"policyRuns":[]}'),imports:db.prepare('SELECT payload FROM institution_imports ORDER BY rowid').all().map(r=>JSON.parse(r.payload)),institutions:institutionProfiles(cases,db.prepare('SELECT payload FROM institutions').all().map(x=>JSON.parse(x.payload))),reviews:db.prepare('SELECT payload FROM reviews').all().map(x=>JSON.parse(x.payload)),notifications:db.prepare('SELECT payload FROM notifications').all().map(x=>JSON.parse(x.payload)),settings:JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get()?.value||JSON.stringify(DEFAULT_SETTINGS))};}
 function save(state){db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM cases; DELETE FROM reviews; DELETE FROM notifications; DELETE FROM institutions; DELETE FROM institution_imports;');const receipt=db.prepare('INSERT INTO institution_imports VALUES(?,?)');for(const r of state.imports||[])receipt.run(r.id,JSON.stringify(r));const profile=db.prepare('INSERT INTO institutions VALUES(?,?)');for(const p of institutionProfiles(state.cases,state.institutions||[]))profile.run(p.id,JSON.stringify(p));const insert=db.prepare('INSERT INTO cases VALUES(?,?,?,?,?)');for(const c of [...state.cases].reverse())insert.run(c.id,c.ownerId||'student',c.bureau,c.region,JSON.stringify(c));const review=db.prepare('INSERT INTO reviews VALUES(?,?)');for(const r of state.reviews)review.run(r.key,JSON.stringify(r));const notification=db.prepare('INSERT INTO notifications VALUES(?,?,?)');for(const n of state.notifications)notification.run(n.id,n.userId,JSON.stringify(n));db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('settings',?)").run(JSON.stringify(state.settings));db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('innovation',?)").run(JSON.stringify(state.innovation||{passports:[],policyRuns:[]}));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 const users=()=>db.prepare('SELECT payload,password_hash FROM users').all().map(r=>({...JSON.parse(r.payload),passwordHash:r.password_hash}));
 return {db,read,save,users,close:()=>db.close()};
}
