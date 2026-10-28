import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createSafeguardViews} from '../public/safeguards.js';
import {createRoleViews} from '../public/roles.js';
import {DEMO_ACCOUNTS} from '../src/auth.mjs';
import {readFile} from 'node:fs/promises';

// Offline HTML fixtures only. This checks markup and handlers, not browser layout.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const c={id:'CASE-UI',title:'Fixture case',institution:'Synthetic Institute',institutionId:'1-UI',description:'A fixture description',region:'North',category:'Fee refund',bureau:'PGRC',officer:'Unassigned',status:'New',priority:'High',version:3,createdAt:'2026-01-01',dueDate:'2099-01-01',canManage:true,canRoute:true,attachments:[{id:'file',name:'ledger.txt',at:'2026-01-01',size:20}],messages:[],tasks:[],notes:[],transfers:[],history:[]};
const fixture=()=>({version:3,requirements:[{id:'remedy',label:'Verify the remedy'},{id:'response',label:'Verify institution response'},{id:'communication',label:'Verify communication'}],objections:[],proof:null,proofCurrent:false,actions:[],dependencies:[],blockers:[],evidenceRefs:[],passports:[],targets:[{id:'CASE-TARGET',bureau:'Regulation Bureau',title:'Other case',tasks:[{id:'task',title:'Inspect the record'}]}]});
function environment(html='<div id="view-content"></div><div id="safeguard-content"></div>'){
 const {document,window}=parseHTML('<html><body>'+html+'</body></html>');globalThis.document=document;
 // LinkeDOM does not implement browser form collections / FormData.
 Object.defineProperty(window.HTMLElement.prototype,'elements',{configurable:true,get(){return Object.fromEntries([...this.querySelectorAll('[name]')].map(el=>[el.getAttribute('name'),el]));}});
 globalThis.FormData=class{constructor(form){this.values=[...form.querySelectorAll('input[name],select[name],textarea[name]')].filter(el=>!['checkbox','radio'].includes(el.type)||el.checked).map(el=>[el.getAttribute('name'),el.tagName==='SELECT'?(el.querySelector('option[selected]')||el.querySelector('option'))?.getAttribute('value')??(el.querySelector('option[selected]')||el.querySelector('option'))?.textContent:el.value]);}[Symbol.iterator](){return this.values[Symbol.iterator]();}};
 return document;
}
const submit=form=>form.onsubmit({preventDefault(){},target:form,submitter:form.querySelector('button[type="submit"]')});
function harness(user=DEMO_ACCOUNTS[0],data=fixture()){
 const document=environment(),state={user,cases:[c,{...c,id:'CASE-TARGET'}],view:'innovation'},calls=[],opened=[];
 const ctx={$:s=>document.querySelector(s),esc,getState:()=>state,toast:()=>{},load:async()=>{},openCase:id=>opened.push(id),stamp:v=>v,api:async url=>url==='/api/innovation'?{cycles:[],waiting:[],policyRuns:[],metrics:{guardReceipts:0,reused:0,jointRequests:0,deadlocks:0,staleEvidence:0}}:data,send:async(url,b,method)=>{calls.push({url,b,method});return {};}};
 return {document,state,ctx,view:createSafeguardViews(ctx),calls,opened,data};
}
test('offline safeguard screens render all six roles with correct controls and escaped data',async()=>{
 for(const user of DEMO_ACCOUNTS){const h=harness(user),d=h.data;d.objections=[{id:'objection',text:'<img src=x onerror=attack()>',by:'<script>bad()</script>',status:'Open',at:'2026-01-01'}];await h.view.mount(c);
  assert.equal(h.document.querySelectorAll('img,script').length,0);assert.match(h.document.body.textContent,/<img src=x/);
  if(user.role==='Complainant'){assert.equal(h.document.querySelector('#guard-check'),null);assert.equal(h.document.querySelector('[data-operation="closure"]'),null);assert.ok(h.document.querySelector('[data-operation="objections"]'));}
  else {assert.ok(h.document.querySelector('#guard-check'));assert.ok(h.document.querySelector('#dependency-form'));assert.ok(h.document.querySelector('[data-operation="closure"]'));assert.equal(h.document.querySelectorAll('.proof-checklist input[required]').length,3);assert.equal(h.document.querySelector('form form'),null);}
  await h.view.dashboard();assert.equal(!!h.document.querySelector('#sandbox-form'),['Admin','Regional Officer'].includes(user.role));
 }
});
test('offline closure form submits all checks, reviewed evidence and the current case revision',async()=>{
 const h=harness();await h.view.mount(c);const form=h.document.querySelector('[data-operation="closure"]');for(const el of form.querySelectorAll('[name="checks"]'))el.checked=true;
 form.querySelector('[name="summary"]').value='Verified outcome and evidence, then communicated the resolution.';form.querySelector('[name="evidence"] option[value="attachment:file"]').setAttribute('selected','');await submit(form);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/cases/CASE-UI/safeguards/closure');assert.deepEqual(h.calls[0].b.checks,['remedy','response','communication']);assert.equal(h.calls[0].b.evidence,'attachment:file');assert.equal(h.calls[0].b.version,3);assert.deepEqual(h.opened,['CASE-UI']);
});
test('offline action guard requires a fresh check and carries the server token to the commit',async()=>{
 const h=harness();h.ctx.send=async(url,b,method)=>{h.calls.push({url,b,method});return url.endsWith('/check')?{checkToken:'server-token',collisions:[],checkedCount:2}:{};};h.view=createSafeguardViews(h.ctx);await h.view.mount(c);
 const form=h.document.querySelector('#guard-check');form.elements.issueKey.value='refund-batch-a';form.elements.summary.value='Inspect this shared refund issue.';await submit(form);
 assert.ok(h.document.querySelector('#guard-commit'));await submit(h.document.querySelector('#guard-commit'));assert.equal(h.calls[1].b.checkToken,'server-token');assert.equal(h.calls[1].b.mode,'proceed');assert.equal(h.calls[1].b.version,3);
 form.oninput();assert.equal(!!h.document.querySelector('#guard-commit'),false);assert.match(h.document.querySelector('#guard-result').textContent,/Run the collision check/);
});
test('offline forms keep input and show an error after a rejected save',async()=>{
 const h=harness();h.ctx.send=async()=>{throw Error('Case changed. Reload before saving.');};h.view=createSafeguardViews(h.ctx);await h.view.mount(c);
 const form=h.document.querySelector('[data-operation="closure"]');form.querySelector('[name="summary"]').value='Keep this entered resolution summary after a conflict.';await submit(form);assert.match(form.querySelector('.inline-error').textContent,/Case changed/);assert.match(form.querySelector('[name="summary"]').value,/Keep this entered/);assert.equal(form.querySelector('button').disabled,false);assert.equal(h.opened.length,0);
});
test('offline passport and action forms preserve version identifiers and read-only boundaries',async()=>{
 const d=fixture();d.evidenceRefs=[{passportId:'passport',reviewedVersion:1,stale:true}];d.passports=[{id:'passport',title:'Ledger passport',sourceCaseId:'CASE-UI',grants:[],canEdit:true,versions:[{version:1,name:'old.txt',source:'Old source',uploader:'Officer',addedBy:'Officer',at:'2026-01-01',sha256:'a'.repeat(64),url:'/old'},{version:2,name:'new.txt',source:'New source',uploader:'Officer',addedBy:'Officer',at:'2026-01-02',sha256:'b'.repeat(64),url:'/new'}]}];d.actions=[{id:'joint',type:'Notice',issueKey:'batch-a',summary:'Joint notice',status:'Joint requested',targetCaseId:'CASE-TARGET',version:2,by:'Officer',at:'2026-01-01',dueDate:'2099-01-01',mode:'joint',receipt:{checkedCount:1,collisions:['one']},history:[]}];
 const h=harness(DEMO_ACCOUNTS[0],d);await h.view.mount(c);assert.equal(h.document.querySelectorAll('.passport-version a').length,2);const form=[...h.document.querySelectorAll('form[data-operation="evidence"]')].find(f=>f.elements.kind.value==='review');form.elements.note.value='Checked updated ledger against the remedy.';await submit(form);assert.equal(h.calls[0].b.passportVersion,2);
 const joint=[...h.document.querySelectorAll('[data-operation="actions/joint"]')].find(f=>f.elements.decision);assert.ok(joint);await submit(joint);assert.equal(h.calls[1].b.actionVersion,2);assert.equal(h.calls[1].method,'PATCH');
 await h.view.mount({...c,canManage:false});assert.equal(h.document.querySelector('form'),null);
});
test('offline role workspace exposes the Safeguards tab to every account',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const user of DEMO_ACCOUNTS){const document=environment(html),dialog=document.querySelector('#case-dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};let mounted=false;
  const roles=createRoleViews({$:s=>document.querySelector(s),esc,icon:()=>'',pill:()=>'',fmt:v=>v,stamp:v=>v,send:async()=>{},api:async()=>{},toast:()=>{},getState:()=>({user,cases:[{...c,canManage:user.role!=='Complainant'}],staff:[],related:[],reviews:[]}),load:async()=>{},setView:()=>{},safeguards:{mount:()=>{mounted=true;}}});roles.openCase(c.id);const tab=document.querySelector('[data-case-tab="safeguards"]');assert.ok(tab);tab.onclick();assert.equal(mounted,true);assert.ok(document.querySelector('#safeguard-content'));
 }
});

test('editing an in-flight action proposal discards its old collision result',async()=>{
 const h=harness();let resolveCheck;
 h.ctx.send=()=>new Promise(resolve=>{resolveCheck=resolve;});h.view=createSafeguardViews(h.ctx);await h.view.mount(c);
 const form=h.document.querySelector('#guard-check');form.elements.issueKey.value='old-matter';form.elements.summary.value='Verify this particular refund matter.';
 const pending=submit(form);form.elements.issueKey.value='new-matter';form.oninput();resolveCheck({checkToken:'old-token',collisions:[],checkedCount:0});await pending;
 assert.equal(!!h.document.querySelector('#guard-commit'),false);assert.match(h.document.querySelector('#guard-result').textContent,/Run the collision check/);assert.equal(form.querySelector('button').disabled,false);
});

test('action commits send the proposal and check token without copying response history',async()=>{
 const h=harness();h.ctx.send=async(url,b)=>{h.calls.push({url,b});return url.endsWith('/check')?{checkToken:'checked',collisions:[],checkedCount:150,checkedActionIds:['not-a-request-field'],proposal:{extra:'not-a-request-field'}}:{};};h.view=createSafeguardViews(h.ctx);await h.view.mount(c);
 const form=h.document.querySelector('#guard-check');form.elements.issueKey.value='refund-batch-a';form.elements.summary.value='Verify this particular refund matter.';await submit(form);await submit(h.document.querySelector('#guard-commit'));
 assert.deepEqual(Object.keys(h.calls[1].b).sort(),['checkToken','dueDate','issueKey','mode','summary','type','version']);
});

test('a delayed sandbox response cannot appear in another account workspace',async()=>{
 const h=harness();let resolveRun;h.ctx.send=()=>new Promise(resolve=>{resolveRun=resolve;});h.view=createSafeguardViews(h.ctx);await h.view.dashboard();
 const pending=submit(h.document.querySelector('#sandbox-form'));h.state.user=DEMO_ACCOUNTS.find(a=>a.id==='regional');await h.view.dashboard();const result=h.document.querySelector('#sandbox-result');
 resolveRun({id:'old-run',user:'Old account',at:'2026-01-01',policy:{slaDays:{High:2,Medium:4,Low:8}},result:{cohort:999,activeBaselineLate:3,activeProposedLate:5,baselineLate:6,proposedLate:8,rerouted:2,unknownDisposalDate:0,asOf:'2026-01-01',workload:[],assumptions:['PRIVATE OLD ACCOUNT RESULT']}});await pending;
 assert.equal(result.textContent,'');assert.doesNotMatch(h.document.body.textContent,/PRIVATE OLD ACCOUNT RESULT/);
});

test('an old mount error cannot replace another account case content',async()=>{
 const h=harness();let rejectRead;h.ctx.api=()=>new Promise((resolve,reject)=>{rejectRead=reject;});h.view=createSafeguardViews(h.ctx);
 const pending=h.view.mount(c);h.state.user=DEMO_ACCOUNTS.find(a=>a.id==='student');h.document.querySelector('#safeguard-content').textContent='Current account content';rejectRead(Error('OLD ACCOUNT ERROR'));await pending;
 assert.equal(h.document.querySelector('#safeguard-content').textContent,'Current account content');
});

test('a successful save does not reopen a case that the reviewer closed while waiting',async()=>{
 const h=harness();h.document.body.innerHTML='<dialog id="test-case-dialog"><div id="safeguard-content"></div></dialog>';const dialog=h.document.querySelector('dialog');dialog.open=true;let resolveSave;h.ctx.send=()=>new Promise(resolve=>{resolveSave=resolve;});h.view=createSafeguardViews(h.ctx);await h.view.mount(c);
 const root=h.document.querySelector('#safeguard-content');
 const pending=submit(root.querySelector('[data-operation="closure"]'));dialog.open=false;resolveSave({ok:true});await pending;assert.deepEqual(h.opened,[]);
});

test('disposed complaints show their historical proof record without asking for a new closure review',async()=>{
 const data=fixture();data.proof={at:'2026-01-01',by:'Reviewing officer',summary:'Verified the remedy and communicated the completed outcome.'};data.proofCurrent=false;
 const h=harness(DEMO_ACCOUNTS[0],data);await h.view.mount({...c,status:'Resolved'});
 assert.match(h.document.body.textContent,/Recorded proof review for disposal/);assert.doesNotMatch(h.document.body.textContent,/refresh before closure/);assert.equal(h.document.querySelectorAll('form').length,0);
});
