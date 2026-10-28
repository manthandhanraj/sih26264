import {createHash,randomUUID} from 'node:crypto';
import {RequestError,text,choice,dueDate,indiaDate,BUREAUS} from './validation.mjs';
import {canManage,canRead,canRoute,isStaff} from './auth.mjs';
import {sameInstitution} from './institutions.mjs';
import {event,notifyCase} from './workflows.mjs';

export const ACTION_TYPES=['Notice','Refund verification','Inspection','Regulatory decision','Escalation'];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now=()=>new Date().toISOString();
const issue=v=>text(v,'Shared issue reference',3,120).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
const actions=s=>s.cases.flatMap(c=>(c.officialActions||[]).map(a=>({...a,caseId:c.id,bureau:c.bureau})));
const canonical=a=>!a.targetActionId;
const active=a=>['Planned','Issued','Joint requested'].includes(a.status);
export function actionProposal(b){return {type:choice(b.type,ACTION_TYPES,'action type'),issueKey:issue(b.issueKey),summary:text(b.summary,'Action summary',10,1000),dueDate:dueDate(b.dueDate)};}
export function collisionCheck(s,c,b){
 const proposal=actionProposal(b);
 if(proposal.dueDate<indiaDate())throw new RequestError('Choose today or a future action deadline.');
 const checked=actions(s).filter(a=>canonical(a)&&active(a)&&sameInstitution(c,s.cases.find(x=>x.id===a.caseId)));
 const collisions=checked.filter(a=>a.issueKey===proposal.issueKey&&a.type===proposal.type).map(a=>({...a,reason:a.dueDate===proposal.dueDate?'Same issue and action type already active':'Same issue and action type with a different deadline'}));
 return {proposal,collisions,checkToken:hash([c.id,c.version,proposal,checked]),checkedCount:checked.length,checkedActionIds:checked.map(a=>a.id)};
}

export function waitingDependencies(s){const cases=new Map(s.cases.map(c=>[c.id,c]));return s.cases.flatMap(c=>(c.dependencies||[]).filter(d=>d.status==='Waiting').filter(d=>{const target=cases.get(d.targetCaseId);return target&&target.status!=='Resolved'&&(!d.taskId||target.tasks?.find(t=>t.id===d.taskId)?.status!=='Done');}).map(d=>({...d,caseId:c.id})));}
// Iterative strongly connected components: avoids a recursion limit on large registers.
export function deadlocks(s){
 const edges=waitingDependencies(s),ids=[...new Set(edges.flatMap(e=>[e.caseId,e.targetCaseId]))],forward=new Map(ids.map(id=>[id,[]])),reverse=new Map(ids.map(id=>[id,[]]));
 for(const e of edges){forward.get(e.caseId).push(e.targetCaseId);reverse.get(e.targetCaseId).push(e.caseId);}
 const seen=new Set(),order=[];
 for(const id of ids){if(seen.has(id))continue;seen.add(id);const stack=[[id,0]];while(stack.length){const top=stack.at(-1),next=forward.get(top[0]);if(top[1]<next.length){const v=next[top[1]++];if(!seen.has(v)){seen.add(v);stack.push([v,0]);}}else{order.push(top[0]);stack.pop();}}}
 seen.clear();const result=[];
 for(const id of order.reverse()){if(seen.has(id))continue;seen.add(id);const group=[],stack=[id];while(stack.length){const v=stack.pop();group.push(v);for(const x of reverse.get(v))if(!seen.has(x)){seen.add(x);stack.push(x);}}if(group.length>1){const set=new Set(group),dependencies=edges.filter(e=>set.has(e.caseId)&&set.has(e.targetCaseId));result.push({id:hash(dependencies.map(d=>d.id).sort()).slice(0,24),caseIds:group.sort(),dependencies});}}
 return result;
}
const passportList=s=>s.innovation?.passports||[];
export function evidenceState(s,c){return (c.evidenceRefs||[]).map(r=>{const p=passportList(s).find(p=>p.id===r.passportId);return {...r,title:p?.title||'Unavailable source',latestVersion:p?.versions.length||0,stale:!p||r.reviewedVersion!==p.versions.length};});}
export function closureRequirements(c){
 const specific={'Fee refund':'Verify refund outcome against payment / ledger evidence; a receipt alone is insufficient.','Faculty grievance':'Verify the faculty remedy against employment / salary records.','Intake compliance':'Verify sanctioned intake against admissions records.','Infrastructure':'Verify corrective work against inspection findings.','Approval status':'Verify the relevant approval order and its period.','Student grievance':'Verify the requested remedy against the student complaint.'};
 return [{id:'remedy',label:specific[c.category]||specific['Student grievance']},{id:'response',label:'Check the institution response and supporting record.'},{id:'communication',label:'Record how the outcome was communicated to the complainant.'}];
}
export function closureBlockers(s,c){
 const blockers=[];
 if((c.tasks||[]).some(t=>t.status==='Open'))blockers.push('Complete open coordination tasks.');
 if(waitingDependencies(s).some(d=>d.caseId===c.id))blockers.push('Resolve or obtain senior release for waiting dependencies.');
 if((c.transfers||[]).some(t=>t.status==='Pending'))blockers.push('Review the pending transfer request.');
 if((c.objections||[]).some(o=>o.status==='Open'))blockers.push('Review outstanding complainant objections.');
 if(evidenceState(s,c).some(r=>r.stale))blockers.push('Review the latest version of referenced evidence.');
 for(const a of c.officialActions||[]){if(canonical(a)&&active(a)||a.status==='Joint requested')blockers.push('Complete or cancel pending official actions.');if(a.targetActionId&&a.status!=='Cancelled'){const target=actions(s).find(x=>x.id===a.targetActionId);if(!target||target.status!=='Completed')blockers.push('The reused / joint source action must be completed.');}}
 return [...new Set(blockers)];
}
export function closureFingerprint(s,c){return hash([c.version,closureBlockers(s,c),evidenceState(s,c),actions(s).filter(a=>(c.officialActions||[]).some(r=>r.targetActionId===a.id))]);}
export function assertClosure(s,c){if(!c.closureProof||c.closureProof.fingerprint!==closureFingerprint(s,c))throw new RequestError('Resolution Proof Check required. Review current evidence and blockers in the Safeguards tab before disposing this case.',409);const blockers=closureBlockers(s,c);if(blockers.length)throw new RequestError(blockers.join(' '),409);}

export function simulatePolicy(cases,b,asOf=indiaDate()){
 if(!b.slaDays||['High','Medium','Low'].some(k=>!Number.isInteger(b.slaDays[k])||b.slaDays[k]<1||b.slaDays[k]>60))throw new RequestError('Each proposed SLA must be an integer from 1 to 60 days.');
 const route=b.route||{};if(Object.keys(route).some(k=>!BUREAUS.includes(k))||Object.values(route).some(v=>!BUREAUS.includes(v)))throw new RequestError('Choose valid bureau routing rules.');
 const add=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
 const rows=cases.map(c=>{const proposedDue=add(indiaDate(new Date(c.createdAt)),b.slaDays[c.priority]),closed=c.status==='Resolved',outcomeDay=closed?c.resolvedAt?indiaDate(new Date(c.resolvedAt)):null:asOf;return {priority:c.priority,bureau:c.bureau,proposedBureau:route[c.bureau]||c.bureau,closed,unknownOutcome:closed&&!outcomeDay,baselineLate:outcomeDay?outcomeDay>c.dueDate:null,proposedLate:outcomeDay?outcomeDay>proposedDue:null};});
 const counts=key=>rows.filter(r=>r[key]===true).length;
 return {asOf,cohort:rows.length,active:rows.filter(r=>!r.closed).length,resolved:rows.filter(r=>r.closed).length,unknownDisposalDate:rows.filter(r=>r.unknownOutcome).length,baselineLate:counts('baselineLate'),proposedLate:counts('proposedLate'),activeBaselineLate:rows.filter(r=>!r.closed&&r.baselineLate).length,activeProposedLate:rows.filter(r=>!r.closed&&r.proposedLate).length,rerouted:rows.filter(r=>r.bureau!==r.proposedBureau).length,workload:BUREAUS.map(bureau=>({bureau,current:rows.filter(r=>!r.closed&&r.bureau===bureau).length,proposed:rows.filter(r=>!r.closed&&r.proposedBureau===bureau).length})),assumptions:['Comparison only; no live deadlines, assignments or policy are changed.','Proposed deadlines = India receipt date + proposed priority SLA. Baseline uses saved deadlines.','Historical disposal dates stay fixed; no prediction of faster resolution or staffing capacity.','Resolved cases without a disposal date are excluded from lateness counts.','Only your directly supervised cases are included. Results contain aggregates, not complaint text.']};
}

export function createInnovationService({getState,transact,users,body,reply,lookup,scoped,sendFile,verifyEvidence}){
 const ensureStaff=u=>{if(!isStaff(u))throw new RequestError('Officer access required.',403);};
 const read=(s,u,id)=>{const c=lookup(s,id);if(!canRead(u,c,scoped(s)))throw new RequestError('Case outside your access.',403);return c;};
 const manage=(s,u,id)=>{const c=read(s,u,id);if(!canManage(u,c))throw new RequestError('Managing desk authority required.',403);return c;};
 const revision=(c,b)=>{if(b.version!==c.version)throw new RequestError('Case changed. Reload before saving.',409);};
 const passport=(s,id)=>{const p=passportList(s).find(p=>p.id===id);if(!p)throw new RequestError('Evidence passport not found.',404);return p;};
 const allowedPassport=(s,u,p)=>isStaff(u)&&(canRead(u,lookup(s,p.sourceCaseId),scoped(s))||p.grants.some(id=>canRead(u,lookup(s,id),scoped(s))));
 const proofSelection=(s,c,key)=>{const [kind,id]=String(key||'').split(':');if(kind==='attachment'){const a=c.attachments.find(a=>a.id===id);if(a)return {kind,id,name:a.name};}if(kind==='passport'){const r=evidenceState(s,c).find(r=>r.passportId===id&&!r.stale);if(r)return {kind,id,version:r.reviewedVersion};}throw new RequestError('Select current case evidence or a reviewed passport.');};
 return {async handle({route,req,res,user}){
  if(route==='/api/innovation'&&req.method==='GET'){
   ensureStaff(user);const s=getState(),scope=scoped(s),visible=s.cases.filter(c=>canRead(user,c,scope)),ids=new Set(visible.map(c=>c.id));
   const cycles=deadlocks(s).filter(g=>g.caseIds.some(id=>ids.has(id))).map(g=>({...g,caseIds:g.caseIds.filter(id=>ids.has(id)),restricted:g.caseIds.some(id=>!ids.has(id)),dependencies:g.dependencies.filter(d=>ids.has(d.caseId)&&ids.has(d.targetCaseId))}));
   reply(res,200,{cycles,waiting:waitingDependencies(s).filter(d=>ids.has(d.caseId)&&ids.has(d.targetCaseId)),policyRuns:(s.innovation?.policyRuns||[]).filter(r=>r.userId===user.id).slice(-10).reverse(),metrics:{guardReceipts:visible.reduce((n,c)=>n+(c.officialActions||[]).length,0),reused:visible.flatMap(c=>c.officialActions||[]).filter(a=>a.status==='Reused').length,jointRequests:visible.flatMap(c=>c.officialActions||[]).filter(a=>a.mode==='joint').length,deadlocks:cycles.length,staleEvidence:visible.reduce((n,c)=>n+evidenceState(s,c).filter(r=>r.stale).length,0)}});return true;
  }
  if(route==='/api/innovation/sandbox'&&req.method==='POST'){
   ensureStaff(user);if(!['Admin','Regional Officer'].includes(user.role))throw new RequestError('Senior policy access required.',403);const b=await body(req);
   const result=await transact(s=>{const cases=s.cases.filter(c=>canRoute(user,c)),result=simulatePolicy(cases,b),run={id:randomUUID(),at:now(),userId:user.id,user:user.name,policy:{slaDays:b.slaDays,route:b.route||{}},result};s.innovation||={passports:[],policyRuns:[]};s.innovation.policyRuns.push(run);s.innovation.policyRuns=s.innovation.policyRuns.slice(-100);return run;});reply(res,201,result);return true;
  }
  const download=route.match(/^\/api\/innovation\/passports\/([a-f0-9-]+)\/versions\/(\d+)\/file$/);
  if(download&&req.method==='GET'){const s=getState(),p=passport(s,download[1]);if(!allowedPassport(s,user,p))throw new RequestError('Passport access denied.',403);const v=p.versions[Number(download[2])-1];if(!v)throw new RequestError('Version not found.',404);const source=lookup(s,p.sourceCaseId),a=source.attachments.find(a=>a.id===v.attachmentId);if(!a)throw new RequestError('Evidence unavailable.',404);await sendFile(res,a);return true;}
  const match=route.match(/^\/api\/cases\/(CASE-[A-Z0-9-]+)\/safeguards(?:\/(check|actions|dependencies|evidence|closure|objections)(?:\/([a-f0-9-]+))?)?$/);
  if(!match)return false;
  const [,caseId,action,itemId]=match;if(action&&action!=='check'&&!((!itemId&&req.method==='POST')||(itemId&&req.method==='PATCH')))throw new RequestError('Method not allowed.',405);const s=getState(),c=read(s,user,caseId);
  if(!action&&req.method==='GET'){
   const result={requirements:closureRequirements(c),objections:c.objections||[],proof:c.closureProof?{at:c.closureProof.at,by:c.closureProof.by,summary:c.closureProof.summary}:null};
   if(isStaff(user)){ensureStaff(user);Object.assign(result,{version:c.version,actions:(c.officialActions||[]).map(a=>({...a,sourceStatus:a.targetActionId?actions(s).find(t=>t.id===a.targetActionId)?.status:undefined})),dependencies:(c.dependencies||[]).map(d=>({...d,effectiveStatus:d.status==='Waiting'&&!waitingDependencies(s).some(w=>w.id===d.id)?'Satisfied':d.status})),blockers:closureBlockers(s,c),proofCurrent:!!c.closureProof&&c.closureProof.fingerprint===closureFingerprint(s,c),evidenceRefs:evidenceState(s,c),passports:passportList(s).filter(p=>(p.sourceCaseId===caseId||p.grants.includes(caseId))&&allowedPassport(s,user,p)).map(p=>({...p,grants:p.grants.filter(id=>canRead(user,lookup(s,id),scoped(s))),canEdit:p.sourceCaseId===caseId&&canManage(user,lookup(s,p.sourceCaseId)),sourceCaseId:canRead(user,lookup(s,p.sourceCaseId),scoped(s))?p.sourceCaseId:null,versions:p.versions.map(v=>({...v,url:`/api/innovation/passports/${p.id}/versions/${v.version}/file`}))})),targets:s.cases.filter(t=>t.id!==caseId&&sameInstitution(t,c)&&canRead(user,t,scoped(s))).map(t=>({id:t.id,bureau:t.bureau,title:t.title,tasks:(t.tasks||[]).filter(t=>t.status==='Open').map(t=>({id:t.id,title:t.title}))}))});}
   reply(res,200,result);return true;
  }
  if(!action)return false;const b=await body(req);
  if(action==='check'&&req.method==='POST'){
   ensureStaff(user);manage(s,user,caseId);const result=collisionCheck(s,c,b);reply(res,200,{...result,collisions:result.collisions.map(a=>canRead(user,lookup(s,a.caseId),scoped(s))?a:{id:a.id,restricted:true,reason:'A restricted related action requires senior coordination.'}),checkedActionIds:undefined});return true;
  }
  const result=await transact(async next=>{
   const c=read(next,user,caseId);
   if(action==='objections'){
    c.objections||=[];
    if(req.method==='POST'&&!itemId){if(user.role!=='Complainant'||c.ownerId!==user.id)throw new RequestError('Only the complainant can lodge an objection.',403);if(c.status==='Resolved')throw new RequestError('Request reopening through resolution feedback first.',409);if(c.objections.filter(o=>o.status==='Open').length>=10)throw new RequestError('Review existing open objections first.');const o={id:randomUUID(),text:text(b.text,'Objection',10,1500),status:'Open',by:user.name,at:now()};c.objections.push(o);event(c,'Complainant raised a resolution objection.',user);notifyCase(next,users,c,'Resolution objection',`${c.id}: an objection needs review.`,{owner:false});return o;}
    ensureStaff(user);manage(next,user,caseId);revision(c,b);const o=c.objections.find(o=>o.id===itemId);if(!o||o.status!=='Open')throw new RequestError('Open objection not found.',409);o.response=text(b.response,'Review response',10,2000);o.status='Reviewed';o.reviewedBy=user.name;o.reviewedAt=now();event(c,'Objection reviewed: '+o.response,user);return o;
   }
   ensureStaff(user);manage(next,user,caseId);revision(c,b);if(c.status==='Resolved')throw new RequestError('Reopen this case before changing safeguards.',409);
   if(action==='actions'&&!itemId&&req.method==='POST'){
    if((c.officialActions||[]).length>=200)throw new RequestError('Action history limit reached.');const check=collisionCheck(next,c,b);if(check.checkToken!==b.checkToken)throw new RequestError('Action context changed. Run the collision check again.',409);
    const mode=choice(b.mode,['proceed','reuse','joint','separate'],'coordination decision');let target;
    if(check.collisions.length){if(mode==='proceed')throw new RequestError('Resolve the collision by reusing, requesting joint action or obtaining a senior exception.',409);if(mode==='separate'&&!canRoute(user,c))throw new RequestError('Separate parallel action requires senior authority.',403);if(['reuse','joint'].includes(mode)){target=check.collisions.find(a=>a.id===b.targetActionId);if(!target||!canRead(user,lookup(next,target.caseId),scoped(next)))throw new RequestError('Select an accessible collision target.',403);}}
    else if(mode!=='proceed')throw new RequestError('No collision exists. Use proceed after checking.');
    const reason=mode==='proceed'?'No matching active action.':text(b.reason,'Coordination reason',10,1500);
    const a={...check.proposal,id:randomUUID(),at:now(),by:user.name,byId:user.id,status:mode==='reuse'?'Reused':mode==='joint'?'Joint requested':'Planned',mode,reason,targetActionId:target?.id,targetCaseId:target?.caseId,version:1,receipt:{at:now(),checkedCount:check.checkedCount,collisions:check.collisions.map(x=>x.id),checkToken:check.checkToken},history:[]};c.officialActions||=[];c.officialActions.push(a);event(c,`Action Collision Guard: ${mode}. ${a.type} / ${a.issueKey}. ${reason}`,user,'internal');
    if(target){const tc=lookup(next,target.caseId);event(tc,`Related case ${c.id} ${mode==='joint'?'requested joint action':'reused this action'}. ${reason}`,user,'internal');notifyCase(next,users,tc,'Action coordination',`${c.id} requested ${mode}. Review the Safeguards tab.`,{owner:false});}return a;
   }
   if(action==='actions'&&itemId&&req.method==='PATCH'){
    const a=c.officialActions?.find(a=>a.id===itemId);if(!a||b.actionVersion!==a.version)throw new RequestError('Action changed or not found. Reload.',409);const note=text(b.note,'Action note',10,1500);
    if(a.status==='Joint requested'&&b.decision){const tc=lookup(next,a.targetCaseId);if(!canManage(user,tc))throw new RequestError('Both the requesting desk and source action manager must be represented by the approver. Ask a common lead or senior to approve.',403);const target=tc.officialActions.find(t=>t.id===a.targetActionId);if(!target||!active(target))throw new RequestError('Source action is no longer active.',409);a.status=choice(b.decision,['Joint approved','Cancelled'],'joint decision');event(tc,`Joint action decision for ${c.id}: ${a.status}. ${note}`,user,'internal');}
    else {if(!canonical(a)&&b.status!=='Cancelled')throw new RequestError('Update the source action; references cannot be independently issued.');const transitions={Planned:['Issued','Cancelled'],Issued:['Completed','Cancelled'],Reused:['Cancelled'],'Joint approved':['Cancelled'],'Joint requested':['Cancelled']};if(!transitions[a.status]?.includes(b.status))throw new RequestError('Invalid action transition.',409);a.status=b.status;}
    a.history.push({at:now(),by:user.name,status:a.status,note});a.version++;event(c,`Official action ${a.status}: ${a.type}. ${note}`,user,'internal');return a;
   }
   if(action==='dependencies'){
    c.dependencies||=[];
    if(!itemId&&req.method==='POST'){const target=read(next,user,b.targetCaseId);if(target.id===c.id||!sameInstitution(c,target)||target.status==='Resolved')throw new RequestError('Choose another active case of the same institution.');if(b.taskId&&!target.tasks?.some(t=>t.id===b.taskId&&t.status==='Open'))throw new RequestError('Choose an open prerequisite task.');if(c.dependencies.some(d=>d.status==='Waiting'&&d.targetCaseId===target.id&&(d.taskId||'')===(b.taskId||'')))throw new RequestError('That dependency is already recorded.',409);if(c.dependencies.length>=100)throw new RequestError('Dependency history limit reached.');const d={id:randomUUID(),targetCaseId:target.id,taskId:b.taskId||null,reason:text(b.reason,'Dependency reason',10,1000),dueDate:dueDate(b.dueDate),status:'Waiting',at:now(),by:user.name};c.dependencies.push(d);event(c,`Waiting on ${target.id}: ${d.reason}`,user,'internal');notifyCase(next,users,target,'Dependency recorded',`${c.id} is waiting for this desk.`,{owner:false});return d;}
    const d=c.dependencies.find(d=>d.id===itemId);if(!d||d.status!=='Waiting')throw new RequestError('Waiting dependency not found.',409);if(!canRoute(user,c))throw new RequestError('Senior authority is required to release a prerequisite.',403);d.status='Released';d.releaseNote=text(b.note,'Release decision',10,1500);d.releasedBy=user.name;d.releasedAt=now();event(c,`Senior dependency release: ${d.targetCaseId}. ${d.releaseNote}`,user,'internal');return d;
   }
   if(action==='evidence'){
    next.innovation||={passports:[],policyRuns:[]};const kind=choice(b.kind,['create','version','share','attach','review'],'passport operation');
    if(kind==='create'){const a=c.attachments.find(a=>a.id===b.attachmentId);if(!a)throw new RequestError('Choose a source attachment.');if(passportList(next).some(p=>p.sourceCaseId===caseId&&p.versions.some(v=>v.attachmentId===a.id)))throw new RequestError('This attachment already belongs to a passport.',409);const p={id:randomUUID(),title:text(b.title,'Passport title',5,200),sourceCaseId:caseId,grants:[],at:now(),by:user.name,versions:[{version:1,attachmentId:a.id,name:a.name,sha256:a.sha256||null,uploader:a.uploadedBy||'Historical uploader not recorded',at:a.at,addedBy:user.name,source:text(b.source,'Evidence source description',10,1000)}]};next.innovation.passports.push(p);c.evidenceRefs||=[];c.evidenceRefs.push({passportId:p.id,reviewedVersion:1,at:now(),by:user.name});event(c,'Evidence Passport created: '+p.title,user,'internal');return p;}
    const p=passport(next,b.passportId);
    if(kind==='version'||kind==='share'){if(p.sourceCaseId!==caseId)throw new RequestError('Only the source case manager may version or share evidence.',403);if(kind==='share'){const target=read(next,user,b.targetCaseId);if(!sameInstitution(c,target)||target.id===c.id)throw new RequestError('Select a related institution case.');if(!p.grants.includes(target.id))p.grants.push(target.id);event(c,`Evidence sharing approved for ${target.id}: ${p.title}`,user,'internal');notifyCase(next,users,target,'Evidence available',`${p.title} is available to attach from Safeguards.`,{owner:false});return p;}
     if(b.passportVersion!==p.versions.length)throw new RequestError('Passport changed. Reload.',409);const a=c.attachments.find(a=>a.id===b.attachmentId);if(!a||p.versions.some(v=>v.attachmentId===a.id))throw new RequestError('Choose a new source attachment.');p.versions.push({version:p.versions.length+1,attachmentId:a.id,name:a.name,sha256:a.sha256||null,uploader:a.uploadedBy||'Historical uploader not recorded',at:a.at,addedBy:user.name,source:text(b.source,'Version source / change',10,1000)});event(c,`Evidence Passport updated: ${p.title}, version ${p.versions.length}`,user,'internal');for(const target of next.cases.filter(t=>t.evidenceRefs?.some(r=>r.passportId===p.id)))notifyCase(next,users,target,'Evidence review required',`${p.title} has a new version.`,{owner:false});return p;
    }
    if(!p.grants.includes(caseId)&&p.sourceCaseId!==caseId)throw new RequestError('Source desk has not approved sharing to this case.',403);
    c.evidenceRefs||=[];let ref=c.evidenceRefs.find(r=>r.passportId===p.id);if(kind==='attach'){if(ref)throw new RequestError('Passport already attached.',409);ref={passportId:p.id,reviewedVersion:0,at:now(),by:user.name};c.evidenceRefs.push(ref);}else{if(!ref||b.passportVersion!==p.versions.length)throw new RequestError('Latest passport version must be reviewed.',409);ref.reviewedVersion=p.versions.length;ref.reviewNote=text(b.note,'Evidence review note',10,1000);ref.reviewedBy=user.name;ref.reviewedAt=now();}event(c,`Evidence Passport ${kind}: ${p.title}`,user,'internal');return ref;
   }
   if(action==='closure'&&req.method==='POST'){
    const blockers=closureBlockers(next,c);if(blockers.length)throw new RequestError(blockers.join(' '),409);
    const requirements=closureRequirements(c);if(!Array.isArray(b.checks)||requirements.some(r=>!b.checks.includes(r.id)))throw new RequestError('Confirm every category-specific closure check.');
    const evidence=proofSelection(next,c,b.evidence);const sourceEvidence=evidence.kind==='attachment'?c.attachments.find(a=>a.id===evidence.id):(()=>{const p=passport(next,evidence.id),source=lookup(next,p.sourceCaseId);return source.attachments.find(a=>a.id===p.versions[evidence.version-1].attachmentId);})();await verifyEvidence(sourceEvidence);evidence.sha256=sourceEvidence.sha256;const summary=text(b.summary,'Verified resolution and communication details',30,3000);
    event(c,'Resolution Proof Check completed. Evidence and remedy reviewed.',user,'internal');c.closureProof={at:now(),by:user.name,byId:user.id,summary,checks:requirements.map(r=>r.id),evidence,fingerprint:closureFingerprint(next,c)};return {ok:true,version:c.version};
   }
   throw new RequestError('Safeguard operation not found.',404);
  });reply(res,200,result);return true;
 }};
}

export function innovationNotifications(s,users){for(const g of deadlocks(s))for(const c of s.cases.filter(c=>g.caseIds.includes(c.id)))for(const u of users.filter(u=>canManage(u,c))){const key=`deadlock:${g.id}:${u.id}`;if(s.notifications.some(n=>n.innovationKey===key))continue;s.notifications.unshift({id:randomUUID(),userId:u.id,caseId:c.id,title:'Deadlock Radar: dependency cycle',body:'Recorded prerequisites form a cycle. A senior coordination decision is required.',at:now(),read:false,innovationKey:key});}}
