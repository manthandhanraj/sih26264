import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';

test('existing demo accounts are renamed without resetting credentials or historical actions',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'samanvay-names-'));let store;
 try{
  store=await openStore(dir,[]);const oldHash=store.users().find(u=>u.id==='regional').passwordHash;
  for(const [id,name] of [['admin','Aditi Sharma'],['regional','Neha Singh']]){const row=store.db.prepare('SELECT payload FROM users WHERE id=?').get(id);const user=JSON.parse(row.payload);user.name=name;store.db.prepare('UPDATE users SET payload=? WHERE id=?').run(JSON.stringify(user),id);}
  const state=store.read();state.cases.push({id:'CASE-NAME',ownerId:'student',bureau:'Regional Office',region:'North',institutionId:'1-TEST',institution:'Demo College',officer:'Neha Singh',version:1,tasks:[{assignedTo:'regional',assignedName:'Neha Singh'}],history:[{actor:'Neha Singh',action:'Historical decision'}]});store.save(state);store.close();
  store=await openStore(dir,[]);assert.equal(store.users().find(u=>u.id==='admin').name,'Sakshi Sharma');assert.equal(store.users().find(u=>u.id==='regional').name,'Nidhi Singh');assert.equal(store.users().find(u=>u.id==='regional').passwordHash,oldHash);const c=store.read().cases[0];assert.equal(c.officer,'Nidhi Singh');assert.equal(c.tasks[0].assignedName,'Nidhi Singh');assert.equal(c.history[0].actor,'Neha Singh');store.close();
  store=await openStore(dir,[]);assert.equal(store.read().cases[0].version,c.version);
 }finally{store?.close();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('samanvay-names-'));await rm(target,{recursive:true,force:true});}
});
