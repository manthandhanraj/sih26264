let configuration;
export async function uploadEvidence({file,type,caseId,send,api}){
 if(!file?.size||file.size>5*1024*1024)throw Error('Choose a non-empty file up to 5 MB.');
 const config=await(configuration??=api('/api/config').catch(e=>{configuration=null;throw e;}));
 if(!config.cloud){
  const content=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Unable to read file.'));r.readAsDataURL(file);});
  return send(`/api/cases/${caseId}/attachments`,{name:file.name,type,content});
 }
 const upload=await send('/api/uploads/sign',{caseId,name:file.name,type,size:file.size});
 const url=new URL(upload.signedUrl);
 if(url.origin!==config.uploadOrigin||url.protocol!=='https:')throw Error('Private upload destination is invalid. Please refresh.');
 let result;try{result=await fetch(url,{method:'PUT',headers:{'Content-Type':type},body:file});}catch{throw Error('Upload connection failed. Your file was not attached; choose it again and retry.');}
 if(!result.ok)throw Error('Private upload failed. Choose the file again and retry.');
 // The API receives only the short signed ticket, avoiding Vercel's 4.5 MB
 // request limit while the full 5 MB file goes straight to private storage.
 return send(`/api/cases/${caseId}/attachments`,{uploadTicket:upload.uploadTicket});
}
