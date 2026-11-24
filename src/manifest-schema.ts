import type { QuadstreamManifest } from './types.js';
type Obj = Record<string,unknown>;
function fail(field:string): never { throw new Error('Invalid manifest: '+field); }
function object(v:unknown,f:string):Obj { if(!v||typeof v!=='object'||Array.isArray(v))return fail(f);return v as Obj; }
function array(v:unknown,f:string):unknown[]{if(!Array.isArray(v))return fail(f);return v;}
function integer(v:unknown,min:number,max:number,f:string):number{
  if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)return fail(f);return v;
}
function bounds(v:unknown,f:string):void{
  const b=array(v,f);
  if(b.length!==4||b.some(x=>typeof x!=='number'||!Number.isFinite(x))||Number(b[0])>Number(b[2])||Number(b[1])>Number(b[3]))fail(f);
}
export const MANIFEST_VERSION=1;
/** Runtime v1 schema and cross-reference checks for untrusted JSON manifests. */
export function validateManifest(input:unknown):QuadstreamManifest {
  const m=object(input,'root');
  if(m.format!=='quadstream'||m.version!==MANIFEST_VERSION)throw new Error('Unsupported Quadstream manifest version');
  const max=integer(m.maxLevel,1,26,'maxLevel');integer(m.fileDepth,1,max,'fileDepth');bounds(m.bounds,'bounds');
  const vertices=array(m.vertices,'vertices').map((v,i)=>{
    const x=object(v,'vertex');if(x.id!==i||typeof x.critical!=='boolean')fail('vertex metadata');
    return integer(x.level,0,max-1,'vertex level');
  });
  if(!vertices.length)fail('empty vertices');
  const arcs=array(m.arcs,'arcs').map((v,i)=>{
    const a=object(v,'arc');if(a.id!==i)fail('arc id');
    const ids=array(a.vertexIds,'arc vertexIds').map(x=>integer(x,0,vertices.length-1,'vertex reference'));
    if(ids.length<2)fail('short arc');return ids;
  });
  const featureIds=new Set<string>();
  const features=array(m.features,'features');
  if(!features.length)fail('empty features');
  for(const raw of features){
    const f=object(raw,'feature');if(typeof f.id!=='string'||featureIds.has(f.id))fail('feature id');featureIds.add(f.id);
    object(f.properties,'properties');bounds(f.bounds,'feature bounds');
    const type=f.geometryType;
    if(type!=='Polygon'&&type!=='MultiPolygon'&&type!=='LineString'&&type!=='MultiLineString')fail('geometry type');
    const closed=type==='Polygon'||type==='MultiPolygon';
    const paths=array(f.paths,'paths');
    for(const rawPath of paths){
      const p=object(rawPath,'path');if(p.closed!==closed)fail('path closed');
      const refs=array(p.arcs,'path arcs');if(!refs.length)fail('empty path');
      let start:number|undefined,end:number|undefined;
      for(const value of refs){
        const ref=integer(value,-arcs.length,arcs.length,'arc reference');if(!ref)fail('zero arc reference');
        const a=arcs[Math.abs(ref)-1]!, first=ref>0?a[0]!:a.at(-1)!,last=ref>0?a.at(-1)!:a[0]!;
        if(end!==undefined&&end!==first)fail('disconnected path');
        start??=first;end=last;
      }
      if(closed&&start!==end)fail('unclosed path');
    }
    const groups=array(f.groups,'groups'),used=new Set<number>();
    if(!groups.length||((type==='Polygon'||type==='LineString')&&groups.length!==1))fail('group count');
    for(const rawGroup of groups){
      const group=array(rawGroup,'group');
      if(!group.length||(!closed&&group.length!==1))fail('group size');
      for(const value of group){
        const i=integer(value,0,paths.length-1,'path reference');if(used.has(i))fail('duplicate path reference');used.add(i);
      }
    }
    if(used.size!==paths.length)fail('path accounting');
  }
  const keys=new Set<string>(),assigned=new Set<number>();
  for(const raw of array(m.partitions,'partitions')){
    const p=object(raw,'partition');
    if(typeof p.key!=='string'||!/^(base|[0-9]{1,2}_[0-9]{1,8}_[0-9]{1,8})$/.test(p.key)||keys.has(p.key))fail('partition key');
    keys.add(p.key);bounds(p.bounds,'partition bounds');
    if(typeof p.checksum!=='string'||!/^[0-9a-f]{8}$/.test(p.checksum))fail('checksum');
    const ids=array(p.vertexIds,'partition vertexIds');
    if(!ids.length||ids.length>1_000_000||p.byteLength!==10+22*ids.length)fail('partition byte length or record count');
    let min=max;
    for(const rawId of ids){
      const id=integer(rawId,0,vertices.length-1,'partition vertex reference');if(assigned.has(id))fail('duplicate partition vertex');assigned.add(id);min=Math.min(min,vertices[id]!);
    }
    if(p.minLevel!==min)fail('partition minLevel');
  }
  if(assigned.size!==vertices.length)fail('partition vertex accounting');
  return input as QuadstreamManifest;
}
