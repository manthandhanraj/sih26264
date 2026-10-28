import {parse} from 'csv-parse/sync';
import readExcelFile from 'read-excel-file/node';
import {inflateRawSync} from 'node:zlib';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {RequestError} from './validation.mjs';

export const IMPORT_LIMITS={bytes:2*1024*1024,rows:2000,columns:50,sheets:12,expandedBytes:12*1024*1024};

// Validate actual decompressed sizes before the workbook reader runs. Reject
// ambiguous/overlapping ZIP entries, encryption and ZIP64, rather than trusting
// archive size declarations or allowing an unbounded compressed upload.
function checkWorkbookZip(bytes){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0)throw Error('Invalid workbook archive.');
 const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||!count||count>256||start+size!==end)throw Error('Unsupported workbook archive.');
 let at=start,total=0;const files=[],names=new Set();
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Invalid workbook directory.');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),n=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  if(flags&1||![0,8].includes(method)||at+46+n+extra+comment>end||expanded>IMPORT_LIMITS.expandedBytes||offset+30>start)throw Error('Unsupported or oversized workbook entry.');
  const name=bytes.subarray(at+46,at+46+n).toString('utf8');
  if(!name||names.has(name)||name.includes('..')||name.includes('\\')||name.startsWith('/')||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method)throw Error('Invalid workbook entry.');
  names.add(name);const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),dataStart=offset+30+localName+localExtra,dataEnd=dataStart+compressed;
  if(dataEnd>start||bytes.subarray(offset+30,offset+30+localName).toString('utf8')!==name)throw Error('Invalid workbook entry bounds.');
  const data=method===0?bytes.subarray(dataStart,dataEnd):inflateRawSync(bytes.subarray(dataStart,dataEnd),{maxOutputLength:IMPORT_LIMITS.expandedBytes});
  total+=data.length;if(data.length!==expanded||total>IMPORT_LIMITS.expandedBytes)throw Error('Workbook expands beyond the 12 MB limit.');
  if(name.startsWith('xl/worksheets/')&&/<(?:[\w.-]+:)?f(?:\s|>)/.test(data.toString('utf8')))throw Error('Formula cells are not supported. Paste values and save the workbook again.');
  files.push({offset,dataEnd,flags,compressed,expanded,crc:bytes.readUInt32LE(at+16)});at+=46+n+extra+comment;
 }
 if(at!==end||!names.has('xl/workbook.xml')||!names.has('[Content_Types].xml'))throw Error('This file is not a supported .xlsx workbook.');
 files.sort((a,b)=>a.offset-b.offset);if(files[0].offset!==0)throw Error('Invalid workbook prefix.');
 for(let i=0;i<files.length;i++){
  const f=files[i],next=files[i+1]?.offset??start,gap=next-f.dataEnd;
  if(!(f.flags&8)){if(gap!==0)throw Error('Unexpected workbook entry data.');}
  else {const descriptor=f.dataEnd+(gap===16?4:0);if(![12,16].includes(gap)||(gap===16&&bytes.readUInt32LE(f.dataEnd)!==0x08074b50)||bytes.readUInt32LE(descriptor)!==f.crc||bytes.readUInt32LE(descriptor+4)!==f.compressed||bytes.readUInt32LE(descriptor+8)!==f.expanded)throw Error('Invalid workbook descriptor.');}
 }
}

function grid(data,sheet){
 if(!data.length||data.length>IMPORT_LIMITS.rows+1)throw new RequestError(`Use a header and no more than ${IMPORT_LIMITS.rows} data rows per sheet.`);
 if(data.some(row=>row.length>IMPORT_LIMITS.columns))throw new RequestError('A sheet can contain up to 50 columns.');
 const headers=data[0].map(v=>String(v??'').trim());
 if(!headers.length||headers.every(v=>!v)||headers.some(v=>v.length>150))throw new RequestError('Use a header row with column names (maximum 150 characters each).');
 const rows=data.slice(1).map((cells,i)=>({row:i+2,cells:cells.map(v=>v instanceof Date?{invalidType:'date'}:v)})).filter(r=>r.cells.some(v=>v!==null&&v!==undefined&&String(v).trim()!==''));
 if(!rows.length)throw new RequestError('No institution rows found below the header.');
 if(rows.some(r=>r.cells.some(v=>typeof v==='string'&&v.length>5000)))throw new RequestError('A cell exceeds the 5,000 character limit.');
 return {sheet,headers,rows};
}

export async function parseImportFile(bytes,name){
 if(!bytes.length||bytes.length>IMPORT_LIMITS.bytes)throw new RequestError('Choose a non-empty file up to 2 MB.');
 const extension=name.toLowerCase().split('.').at(-1);
 if(extension==='csv'){
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new RequestError('Save the CSV as UTF-8 and upload it again.');}
  if(value.includes('\0'))throw new RequestError('This is not a UTF-8 CSV file.');
  try{return [grid(parse(value,{bom:true,relax_column_count:true,max_record_size:20000,to:IMPORT_LIMITS.rows+2}),'CSV')];}catch(e){if(e.status)throw e;throw new RequestError('Cannot read CSV. Check quoted fields, commas and row sizes.');}
 }
 if(extension!=='xlsx')throw new RequestError('Upload .csv or .xlsx. For older .xls files, save as .xlsx first.');
 try{
  checkWorkbookZip(bytes);
  const sheets=await readExcelFile(bytes,{trim:false});
  if(sheets.length>IMPORT_LIMITS.sheets)throw Error('Use a workbook with no more than 12 sheets.');
  // Empty sheets may be harmless cover pages; show sheets that contain records.
  const nonempty=sheets.filter(s=>s.data.length>1&&s.data.slice(1).some(r=>r.some(v=>v!==null&&v!==undefined&&String(v).trim()!=='')));
  if(!nonempty.length)throw Error('No institution data rows found in this workbook.');
  const result=nonempty.map(s=>grid(s.data,s.sheet));
  if(result.reduce((n,s)=>n+s.rows.length,0)>4000)throw Error('Use no more than 4,000 rows across workbook sheets.');
  return result;
 }catch(e){if(e.status)throw e;throw new RequestError(e.message?.includes('Formula')||e.message?.includes('limit')||e.message?.startsWith('Use ')||e.message?.startsWith('No institution')?e.message:'Cannot read this workbook. Upload a standard, unencrypted .xlsx file.');}
}

export function parseInWorker(bytes,name){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL(import.meta.url),{workerData:{importFile:true,bytes,name},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:24}});let settled=false;
 const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);};
 const timer=setTimeout(()=>finish(new RequestError('File took too long to read. Split it into a smaller file.')),12000);
 worker.once('message',m=>finish(m.error?new RequestError(m.error):null,m.sheets));worker.once('error',()=>finish(new RequestError('Unable to read this file within the import limits.')));worker.once('exit',()=>{if(!settled)finish(new RequestError('File reader stopped. Try a smaller workbook.'));});
});}

if(!isMainThread&&workerData?.importFile){try{parentPort.postMessage({sheets:await parseImportFile(Buffer.from(workerData.bytes),workerData.name)});}catch(e){parentPort.postMessage({error:e.status?e.message:'Cannot read this file. Check the format and try again.'});}}
