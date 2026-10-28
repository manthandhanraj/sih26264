// Shared report calculations. Every report starts with the caller's authorized case scope.
export const indiaDay=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const age=(day,at)=>Math.max(0,Math.floor((Date.parse(day)-Date.parse(indiaDay(new Date(at))))/86400000));
export const transferred=c=>(c.transfers||[]).some(t=>t.status==='Approved')||c.history?.some(h=>/bureau: .+ →|Transfer approved:/i.test(h.action));
export function filterCases(cases,f={}){const q=(f.query||'').trim().toLowerCase();return cases.filter(c=>(!q||[c.id,c.title,c.description,c.institution,c.institutionId,c.officer].join(' ').toLowerCase().includes(q))&&(!f.status||(f.status==='Pending'?['New','Awaiting response'].includes(c.status):c.status===f.status))&&(!f.bureau||c.bureau===f.bureau)&&(!f.priority||c.priority===f.priority)&&(!f.region||c.region===f.region)&&(!f.category||c.category===f.category)&&(!f.institutionId||c.institutionId===f.institutionId)&&(!f.from||indiaDay(new Date(c.createdAt))>=f.from)&&(!f.to||indiaDay(new Date(c.createdAt))<=f.to)&&(!f.transferred||transferred(c)));}
export function summarize(cases,today=indiaDay()){
 const active=cases.filter(c=>c.status!=='Resolved'),disposed=cases.filter(c=>c.status==='Resolved');
 return {total:cases.length,pending:cases.filter(c=>['New','Awaiting response'].includes(c.status)).length,underProcess:cases.filter(c=>c.status==='In progress').length,disposed:disposed.length,transferred:cases.filter(transferred).length,escalated:cases.filter(c=>c.status==='Escalated').length,overdue:active.filter(c=>c.dueDate<today).length,active:active.length,disposalRate:cases.length?Math.round(disposed.length/cases.length*1000)/10:0};
}
export function analytics(cases,pairs=[],reviews=[],today=indiaDay()){
 const group=key=>[...new Set(cases.map(c=>c[key]))].sort().map(name=>({name,...summarize(cases.filter(c=>c[key]===name),today)}));
 const active=cases.filter(c=>c.status!=='Resolved');const bands=[['0–7 days',0,7],['8–15 days',8,15],['16–30 days',16,30],['31–60 days',31,60],['61–90 days',61,90],['90+ days',91,Infinity]];
 const months=new Map(),quarters=new Map();
 const bucket=(map,key)=>{if(!map.has(key))map.set(key,{period:key,received:0,disposed:0});return map.get(key);};
 const add=(at,key)=>{const day=indiaDay(new Date(at)),month=day.slice(0,7),quarter=day.slice(0,4)+'-Q'+Math.ceil(Number(day.slice(5,7))/3);bucket(months,month)[key]++;bucket(quarters,quarter)[key]++;};
 for(const c of cases){add(c.createdAt,'received');if(c.status==='Resolved'){const at=c.resolvedAt||[...(c.history||[])].reverse().find(h=>/Resolved|disposed/i.test(h.action))?.at;if(at)add(at,'disposed');}}
 const ids=new Set(cases.map(c=>c.id)),visible=pairs.filter(p=>ids.has(p.a)&&ids.has(p.b));
 return {summary:summarize(cases,today),byBureau:group('bureau'),byRegion:group('region'),byInstitution:group('institutionId').map(r=>({...r,institution:cases.find(c=>c.institutionId===r.name)?.institution})),byStatus:group('status'),byCategory:group('category'),ageing:bands.map(([name,min,max])=>({name,count:active.filter(c=>{const n=age(today,c.createdAt);return n>=min&&n<=max;}).length})),monthly:[...months.values()].sort((a,b)=>a.period.localeCompare(b.period)),quarterly:[...quarters.values()].sort((a,b)=>a.period.localeCompare(b.period)),overlaps:{potential:visible.length,crossBureau:visible.filter(p=>p.crossBureau).length,semantic:visible.filter(p=>p.semanticMatch).length,linked:reviews.filter(r=>ids.has(r.a)&&ids.has(r.b)&&r.decision==='Linked').length,dismissed:reviews.filter(r=>ids.has(r.a)&&ids.has(r.b)&&r.decision==='Dismissed').length},asOf:today};
}
