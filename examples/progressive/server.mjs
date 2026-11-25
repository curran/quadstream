import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
const allowed=['examples/progressive/','dist/','node_modules/maplibre-gl/dist/'];
createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname==='/'?'examples/progressive/index.html':pathname.slice(1);
  if(req.method!=='GET'||!allowed.some(prefix=>relative.startsWith(prefix)))throw new Error('Not found');
  const path=await realpath(resolve(root,relative));
  if(!path.startsWith(root+sep)||!allowed.some(prefix=>path.startsWith(resolve(root,prefix)+sep)))throw new Error('Not found');
  const bytes=await readFile(path);
  res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT??4173),'127.0.0.1');
