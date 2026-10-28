import {readFile} from 'node:fs/promises';
const files={'/':'index.html','/app.js':'app.js','/roles.js':'roles.js','/styles.css':'styles.css','/designs.css':'designs.css','/insights.js':'insights.js','/requirements.js':'requirements.js','/import.js':'import.js','/safeguards.js':'safeguards.js','/uploads.js':'uploads.js'};
export async function serveStatic(req,res,uploadOrigin=''){
 const file=files[new URL(req.url,'http://localhost').pathname];if(!file||!['GET','HEAD'].includes(req.method))return false;
 const bytes=req.method==='HEAD'?null:await readFile(new URL('../public/'+file,import.meta.url));
 res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' ${uploadOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`});
 res.end(bytes);return true;
}
