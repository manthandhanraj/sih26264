// Institution identity is authoritative by Permanent ID. Names never override conflicting IDs.
export const normalizeName=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/\b(inst|engg|tech)\b/g,w=>({inst:'institute',engg:'engineering',tech:'technology'}[w])).replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export function sameInstitution(a,b){
 const ai=String(a.institutionId||'').trim().toUpperCase(),bi=String(b.institutionId||'').trim().toUpperCase();
 if(ai&&bi)return ai===bi;
 const an=normalizeName(a.institution),bn=normalizeName(b.institution);
 return an.length>=8&&an===bn&&a.region&&a.region!=='Not specified'&&a.region===b.region;
}
export function institutionProfiles(cases,existing=[]){
 const map=new Map(existing.map(p=>[p.id,p]));
 for(const c of cases){if(!map.has(c.institutionId))map.set(c.institutionId,{id:c.institutionId,name:c.institution,region:c.region,address:c.address||'',city:'',state:'',pincode:'',contact:'',aliases:[],version:1});}
 return [...map.values()];
}
export function caseSummary(c){
 const last=c.history?.at(-1);
 const task=(c.tasks||[]).filter(t=>t.status==='Open').sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0];
 return {...c,lastAction:last?.action||'Complaint received',lastActionAt:last?.at||c.createdAt,lastActionBy:last?.actor||'Intake',nextAction:c.nextAction||task?.title||(c.status==='Resolved'?'No further action — disposed':c.status==='Awaiting response'?'Await complainant clarification':c.officer==='Unassigned'?'Assign a responsible officer':'Review complaint and record the next action'),nextActionDue:task?.dueDate||c.dueDate};
}
