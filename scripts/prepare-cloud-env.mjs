import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const destination=new URL('../.env.local',import.meta.url);
try{
 const source=(await readFile(new URL('../.env.example',import.meta.url),'utf8')).replace('CRON_SECRET=','CRON_SECRET='+randomBytes(32).toString('hex'));
 await writeFile(destination,source,{flag:'wx',mode:0o600});
 console.log('Created private .env.local with a generated maintenance secret. Fill the Supabase URL and server key locally; do not paste them into chat or Git.');
}catch(e){if(e.code==='EEXIST')console.log('Existing .env.local preserved.');else throw e;}
