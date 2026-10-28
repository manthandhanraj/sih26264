import {createHash} from 'node:crypto';
import {RequestError,REGIONS} from './validation.mjs';
import {normalizeName} from './institutions.mjs';

export const IMPORT_FIELDS=[
 {key:'id',label:'AICTE Permanent ID',required:true,aliases:['aicte permanent id','permanent id','institution id','institute id','aicte id','id']},
 {key:'name',label:'Institution name',required:true,aliases:['institution name','institute name','college name','name','institution']},
 {key:'region',label:'Region',required:true,aliases:['region','aicte region']},
 {key:'address',label:'Address',aliases:['address','institution address','institute address']},
 {key:'city',label:'City / district',aliases:['city','district','city district']},
 {key:'state',label:'State / UT',aliases:['state','state ut','state union territory']},
 {key:'pincode',label:'PIN code',aliases:['pincode','pin code','postal code','pin']},
 {key:'contact',label:'Institution contact',aliases:['contact','email','contact email','institution contact']},
 {key:'aliases',label:'Alternative names',aliases:['aliases','alternative names','alternate names']},
 {key:'aisheCode',label:'AISHE code (separate ID)',aliases:['aishe code','aishe id']},
 {key:'source',label:'Data source',aliases:['source','data source','source url']},
 {key:'academicYear',label:'Academic year',aliases:['academic year','year','source year']},
];
export function suggestMapping(headers){return Object.fromEntries(IMPORT_FIELDS.map(f=>{const matches=headers.map((h,i)=>f.aliases.includes(normalizeName(h))?i:-1).filter(i=>i>=0);return [f.key,matches.length===1?matches[0]:null];}));}
export function normalizeMapping(mapping,headers){
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw new RequestError('Choose column mappings for this file.');
 const result={},taken=new Set();
 for(const field of IMPORT_FIELDS){const value=mapping[field.key];if(value===null||value===undefined||value===''){result[field.key]=null;continue;}if(!Number.isInteger(value)||value<0||value>=headers.length||taken.has(value))throw new RequestError('Map each selected column to one field only.');taken.add(value);result[field.key]=value;}
 if(Object.keys(mapping).some(k=>!IMPORT_FIELDS.some(f=>f.key===k)))throw new RequestError('Unknown import mapping field.');return result;
}

export function buildImportPlan(sheet,mapping,defaultRegion,institutions){
 mapping=normalizeMapping(mapping,sheet.headers);
 if(defaultRegion&&!REGIONS.includes(defaultRegion))throw new RequestError('Choose a valid default region.');
 const existing=new Map(institutions.map(p=>[p.id.toUpperCase(),p]));
 const counts=new Map();for(const r of sheet.rows){const value=mapping.id===null?'':String(r.cells[mapping.id]??'').trim().toUpperCase();if(value)counts.set(value,[...(counts.get(value)||[]),r.row]);}
 const rows=sheet.rows.map(row=>{
  const record={},errors=[],warnings=[];
  for(const field of IMPORT_FIELDS){const raw=mapping[field.key]===null?'':row.cells[mapping[field.key]];if(raw!==null&&raw!==undefined&&typeof raw!=='string'&&!(typeof raw==='number'&&Number.isSafeInteger(raw)))errors.push(field.label+': use text or a whole number; dates and boolean cells are not accepted.');record[field.key]=typeof raw==='string'||typeof raw==='number'?String(raw).trim():'';}
  record.id=record.id.toUpperCase();
  const region=record.region||defaultRegion||'';record.region=REGIONS.find(r=>r.toLowerCase().replaceAll(' ','')===region.toLowerCase().replaceAll(' ',''))||region;
  for(const [key,label,min,max] of [['id','Permanent ID',2,60],['name','Institution name',3,200],['address','Address',0,500],['city','City / district',0,100],['state','State',0,100],['contact','Contact',0,200],['aisheCode','AISHE code',0,60],['source','Source',0,500]])if(record[key].length<min||record[key].length>max)errors.push(`${label}: ${min?`use ${min}–${max} characters`:`maximum ${max} characters`}.`);
  if(record.id&&!/^[A-Z0-9][A-Z0-9-]*$/.test(record.id))errors.push('Permanent ID can contain letters, numbers and hyphens.');
  if(!REGIONS.includes(record.region))errors.push('Region is required: choose North, South, East, West, Central, North East or Not specified.');
  if(record.pincode&&!/^[1-9][0-9]{5}$/.test(record.pincode))errors.push('PIN code must contain six digits and cannot start with zero.');
  if(record.academicYear&&!/^20\d{2}(?:-(?:\d{2}|20\d{2}))?$/.test(record.academicYear))errors.push('Academic year: use a year such as 2026 or 2026-27.');
  record.aliases=record.aliases?record.aliases.split(/[;\n]/).map(s=>s.trim()).filter(Boolean):[];
  if(record.aliases.length>12||record.aliases.some(s=>s.length<3||s.length>200))errors.push('Use up to 12 aliases, each 3–200 characters, separated by semicolons.');
  if(row.cells.length>sheet.headers.length&&row.cells.slice(sheet.headers.length).some(v=>v!==null&&v!==undefined&&String(v).trim()))errors.push('This row contains values beyond the header columns.');
  if(Object.values(record).some(v=>typeof v==='string'&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)))errors.push('Remove unsupported control characters.');
  let status=errors.length?'invalid':'ready';
  if(record.id&&counts.get(record.id)?.length>1){status='duplicate-file';errors.push('Repeated Permanent ID in file rows '+counts.get(record.id).join(', ')+'. Resolve all copies before importing this ID.');}
  if(existing.has(record.id)){
   const p=existing.get(record.id);status=normalizeName(p.name)===normalizeName(record.name)?'existing':'conflict';
   errors.push(status==='existing'?'Permanent ID already exists. This row will be skipped; existing details stay unchanged.':`Permanent ID already belongs to ${p.name}. Review the name/ID mismatch.`);
  }
  if(!record.address)warnings.push('Address not supplied.');if(!record.source)warnings.push('Source not supplied; the uploaded file will be recorded as provenance.');
  const names=institutions.filter(p=>p.id!==record.id&&p.region===record.region&&normalizeName(p.name)===normalizeName(record.name));if(names.length)warnings.push('Matching institution name exists with another ID. Verify the Permanent ID: '+names.map(p=>p.id).join(', '));
  return {row:row.row,record,status,errors,warnings};
 });
 const summary={total:rows.length,ready:rows.filter(r=>r.status==='ready').length,invalid:rows.filter(r=>r.status==='invalid').length,duplicates:rows.filter(r=>r.status==='duplicate-file').length,existing:rows.filter(r=>r.status==='existing').length,conflicts:rows.filter(r=>r.status==='conflict').length};
 return {mapping,defaultRegion:defaultRegion||'',rows,summary,signature:createHash('sha256').update(JSON.stringify(rows.map(r=>({row:r.row,record:r.record,status:r.status,errors:r.errors,warnings:r.warnings})))).digest('hex')};
}
