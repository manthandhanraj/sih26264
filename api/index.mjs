import {timingSafeEqual} from 'node:crypto';
import {createApplication} from '../server.mjs';
import {cloudConfig,createCloudBackend} from '../src/cloud-store.mjs';
import {serveStatic} from '../src/static.mjs';
import {DEMO_ACCOUNTS,ROLE_POLICIES} from '../src/auth.mjs';
import {indiaDate} from '../src/validation.mjs';

let backend;
function configuredBackend(){return backend??=createCloudBackend(cloudConfig());}
function sameSecret(a,b){const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&aa.length>0&&timingSafeEqual(aa,bb);}
export function createServerlessHandler({getBackend=configuredBackend,getOrigin=()=>cloudConfig().origin,getCronSecret=()=>process.env.CRON_SECRET}={}){
 return async function handler(req,res){
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  let app;
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(!pathname.startsWith('/api/')){
    let uploadOrigin='';try{uploadOrigin=new URL(process.env.SUPABASE_URL).origin;}catch{}
    if(await serveStatic(req,res,uploadOrigin))return;
    return reply(404,{error:'Page not found.'});
   }
   if(pathname==='/api/auth/demo'&&req.method==='GET')return reply(200,{accounts:DEMO_ACCOUNTS.map(a=>({...a,authority:ROLE_POLICIES[a.role]})),demo:true,cloud:true});
   if(pathname==='/api/cron'&&(!getCronSecret()||!sameSecret(req.headers.authorization,'Bearer '+getCronSecret())))return reply(403,{error:'Scheduled maintenance authorization required.'});
   const cloud=await getBackend();
   app=await createApplication({cloudBackend:cloud,publicOrigin:getOrigin(),allowedOrigins:cloud.config.origins||[],serverless:true,scheduler:false});
   if(pathname==='/api/cron'){
    if(req.method!=='GET')return reply(405,{error:'Method not allowed.'});
    await app.tick();const backups=await app.listBackups();let backupId=null;
    if(!backups.some(b=>indiaDate(new Date(b.at))===indiaDate()))backupId=await app.backup();
    await cloud.rpc('samanvay_cleanup');await cloud.cleanPending();
    return reply(200,{ok:true,backupId});
   }
   // Every invocation gets its own state snapshot. Database CAS protects writes
   // across warm functions, cold starts and concurrent server instances.
   await new Promise((resolve,reject)=>{
    res.once('finish',resolve);res.once('close',resolve);res.once('error',reject);
    app.server.emit('request',req,res);
   });
  }catch(e){if(!res.headersSent)reply(e.status||503,{error:e.status?e.message:'Cloud service is unavailable. Check the Supabase setup and Vercel runtime logs.'});else res.end();if(!e.status)console.error('Cloud request failed:',e.code||e.name||'unknown');}
  finally{if(app)await app.cleanup();}
 };
}
export default createServerlessHandler();
