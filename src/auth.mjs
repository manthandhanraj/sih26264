import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {RequestError} from './validation.mjs';

export const ROLE_POLICIES={
 Admin:{level:4,title:'Administrator',label:'Highest authority',powers:['All bureaus and regions','Approve transfers and appoint leads','Configure SLA policy and escalations','Create and download backups']},
 'Regional Officer':{level:3,title:'Regional Officer',label:'Regional oversight',powers:['Manage cases in assigned region','Approve regional transfers and leads','Review regional escalations','Coordinate regional action items']},
 'Bureau Officer':{level:2,title:'Bureau Officer',label:'Bureau operations',powers:['Manage complaints at own bureau','Reply and request clarification','Request transfers for senior approval','Maintain evidence and coordination tasks']},
 Complainant:{level:1,title:'Complainant',label:'Personal portal',powers:['Submit and track own complaints','Reply to officer clarification','Upload own supporting evidence','Rate resolution or request reopening']},
};

export const DEMO_ACCOUNTS=[
 {id:'admin',name:'Sakshi Sharma',role:'Admin',email:'admin@samanvay.demo',password:'Admin@2026',scope:'All bureaus & regions'},
 {id:'pgrc',name:'Rahul Mehta',role:'Bureau Officer',bureau:'PGRC',email:'pgrc@samanvay.demo',password:'Pgrc@2026',scope:'Public Grievance Redressal Cell'},
 {id:'regulation',name:'Priya Rao',role:'Bureau Officer',bureau:'Regulation Bureau',email:'regulation@samanvay.demo',password:'Regulation@2026',scope:'Regulation Bureau'},
 {id:'regional',name:'Nidhi Singh',role:'Regional Officer',region:'North',bureau:'Regional Office',email:'regional@samanvay.demo',password:'Regional@2026',scope:'North region'},
 {id:'student',name:'Aarav Kumar',role:'Complainant',email:'student@samanvay.demo',password:'Student@2026',scope:'Student complaint portal'},
 {id:'faculty',name:'Kavya Desai',role:'Complainant',email:'faculty@samanvay.demo',password:'Faculty@2026',scope:'Faculty complaint portal'},
];
export function hashPassword(password,salt=randomBytes(16).toString('hex')){return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password,hash){const [salt,key]=hash.split(':');const value=scryptSync(password,salt,64);const expected=Buffer.from(key,'hex');return value.length===expected.length&&timingSafeEqual(value,expected);}
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export const safeUser=u=>{const {passwordHash,...rest}=u;return {...rest,authority:ROLE_POLICIES[u.role]};};
export const isStaff=u=>u.role!=='Complainant';
export const directAccess=(u,c)=>u.role==='Admin'||(u.role==='Complainant'?c.ownerId===u.id:u.role==='Regional Officer'?c.region===u.region:c.bureau===u.bureau);
export function connectedIds(cases,reviews,id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const r of reviews.filter(r=>r.decision==='Linked'))if(ids.has(r.a)||ids.has(r.b)){if(!ids.has(r.a)||!ids.has(r.b))changed=true;ids.add(r.a);ids.add(r.b);}}return [...ids].filter(id=>cases.some(c=>c.id===id));}
export function canRead(u,c,state){if(directAccess(u,c))return true;if(!isStaff(u))return false;if(c.leadOfficerId===u.id||c.tasks?.some(t=>t.assignedTo===u.id))return true;const connected=connectedIds(state.cases,state.reviews,c.id);if(state.cases.some(other=>connected.includes(other.id)&&(directAccess(u,other)||other.leadOfficerId===u.id||other.tasks?.some(t=>t.assignedTo===u.id))))return true;return (state.pairs||[]).some(p=>(p.a===c.id||p.b===c.id)&&state.cases.some(other=>other.id===(p.a===c.id?p.b:p.a)&&directAccess(u,other)));}
export function canManage(u,c){return isStaff(u)&&(directAccess(u,c)||c.leadOfficerId===u.id);}
export function requireManage(u,c){if(!canManage(u,c))throw new RequestError('You can view this coordinated case, but only its owning desk or lead officer can change it.',403);}
export const canRoute=(u,c)=>u.role==='Admin'||(u.role==='Regional Officer'&&c.region===u.region);
export function visibleCase(u,c){if(isStaff(u))return {...c,canRoute:canRoute(u,c)};const {notes,tasks,leadOfficerId,slaEvents,transfers,officialActions,dependencies,evidenceRefs,closureProof,objections,...rest}=c;return {...rest,history:c.history.filter(h=>h.visibility!=='internal'),attachments:c.attachments.filter(a=>a.visibility!=='internal')};}
