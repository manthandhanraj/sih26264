import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {cloudConfig,createCloudBackend} from '../src/cloud-store.mjs';

try{
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Set the Vercel Node.js runtime to 24.x.');
 const missing=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SAMANVAY_PUBLIC_URL'].filter(name=>!process.env[name]);
 if(missing.length)throw Error('Missing '+missing.join(', ')+'. Fill and SAVE the private .env.local file in this project, then run cloud:check again. Vercel environment variables must be configured separately before deployment.');
 const config=cloudConfig();
 if(!process.env.CRON_SECRET||process.env.CRON_SECRET.length<32)throw Error('Set CRON_SECRET to a private random value of at least 32 characters.');
 if(config.key.startsWith('sb_publishable_'))throw Error('Use a server-side Supabase secret/service_role key, not the publishable key.');
 if(config.key.startsWith('eyJ')){let payload;try{payload=JSON.parse(Buffer.from(config.key.split('.')[1],'base64url'));}catch{throw Error('Supabase service key format is invalid.');}if(payload.role!=='service_role')throw Error('Use the service_role key, not an anon or user token.');}
 await readFile(new URL('../public/index.html',import.meta.url));
 await readFile(new URL('../templates/institution-import-template.xlsx',import.meta.url));
 console.log('Node runtime, cloud environment names and deployment assets checked. Secret values are not printed.');
 if(!process.argv.includes('--build')){
  const backend=createCloudBackend(config);await backend.rpc('samanvay_open');await backend.checkBucket();
  const key='pending/check-'+randomUUID(),bytes=Buffer.from('Synthetic storage connectivity check.');let written=false;
  try{await backend.write(key,bytes,'text/plain');written=true;if(!(await backend.read(key)).equals(bytes))throw Error('Storage read-back did not match.');await backend.signDownload(key,'check.txt');}
  finally{if(written)await backend.remove(key);}
  console.log('Cloud RPC and private storage write/read/sign/delete checks passed.');
 }
}catch(e){console.error('Cloud setup check failed: '+e.message);process.exitCode=1;}
