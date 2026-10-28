import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput,updateInput,indiaDate,dueDate} from '../src/validation.mjs';
const valid={title:'A valid case title',description:'A detailed complaint description for testing.',institution:'Test Institute',institutionId:'1-123',category:'Fee refund',bureau:'PGRC',priority:'Medium',region:'North'};
test('invalid request shapes, enums and field types are rejected',()=>{for(const b of [null,[],1,{...valid,region:{}},{...valid,category:'arbitrary'},{...valid,title:'   '},{...valid,institutionId:'../x'}])assert.throws(()=>createInput(b));});
test('normalizes identifiers and trims values',()=>{assert.equal(createInput({...valid,institutionId:' demo-42 '}).institutionId,'DEMO-42');});
test('dates use India timezone across midnight UTC boundary',()=>{assert.equal(indiaDate(new Date('2026-10-20T20:00:00Z')),'2026-10-21');assert.throws(()=>dueDate('2026-02-30'));});
test('resolution and transfer require an explanation',()=>{const c={version:1,status:'New',bureau:'PGRC'};assert.throws(()=>updateInput({version:1,status:'Resolved'},c));assert.throws(()=>updateInput({version:1,bureau:'Regional Office',note:'short'},c));assert.equal(updateInput({version:1,status:'Resolved',note:'Verified and resolved with supporting evidence.'},c).changes.status,'Resolved');});
test('stale revisions cannot overwrite changes',()=>{assert.throws(()=>updateInput({version:1,note:'A new action note'},{version:2}),e=>e.status===409);});
