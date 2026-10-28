import {randomUUID} from 'node:crypto';
import {indiaDate} from './validation.mjs';
import {directAccess,isStaff} from './auth.mjs';

export const event=(c,action,user,visibility='public')=>{c.history.push({at:new Date().toISOString(),action,actor:user.name||user,actorId:user.id||null,bureau:user.bureau||c.bureau,role:user.role||'System',visibility});c.version++;};
export function notify(state,userId,caseId,title,body){if(!userId)return;state.notifications.unshift({id:randomUUID(),userId,caseId,title,body,at:new Date().toISOString(),read:false});}
export function notifyCase(state,users,c,title,body,{owner=true,staff=true,exclude}={}){for(const u of users)if(u.id!==exclude&&((owner&&u.id===c.ownerId)||(staff&&isStaff(u)&&(directAccess(u,c)||c.leadOfficerId===u.id))))notify(state,u.id,c.id,title,body);}
export function runSla(state,users,now=new Date()){
 const today=indiaDate(now);let count=0;
 for(const c of state.cases){if(c.status==='Resolved')continue;c.slaEvents||=[];const days=Math.floor((Date.parse(today)-Date.parse(c.dueDate))/86400000);
  const kind=days>0&&days>=state.settings.escalateAfterDays?'escalation':days<=0&&days>=-state.settings.remindBeforeDays?'reminder':null;
  if(!kind)continue;const key=c.dueDate+':'+kind;if(c.slaEvents.includes(key))continue;c.slaEvents.push(key);count++;
  if(kind==='escalation'){c.escalationLevel=(c.escalationLevel||0)+1;c.escalatedAt=now.toISOString();c.status='Escalated';event(c,`SLA escalation: deadline ${c.dueDate} exceeded. Admin notified.`,{name:'SLA scheduler'});notifyCase(state,users,c,'Deadline escalated',`${c.id} is overdue. Senior review is required.`);}
  else{event(c,`Deadline reminder: action is due on ${c.dueDate}.`,{name:'SLA scheduler'});notifyCase(state,users,c,'Deadline approaching',`${c.id} is due on ${c.dueDate}.`);}
 }
 return count;
}
