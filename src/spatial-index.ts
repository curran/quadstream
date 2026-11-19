import { intersects, unionBounds } from './geometry.js';
import type { Bounds } from './types.js';
interface Entry<T>{bounds:Bounds;value:T;ordinal:number}
interface Node<T>{bounds:Bounds;children?:Node<T>[];entries?:Entry<T>[]}
/** Deterministic, immutable packed bounding-volume hierarchy for static geometry. */
export function createSpatialIndex<T>(items:readonly {bounds:Bounds;value:T}[],bucketSize=16){
  if(!Number.isInteger(bucketSize)||bucketSize<2)throw new Error('bucketSize must be >=2');
  const entries:Entry<T>[]=items.map((x,ordinal)=>({bounds:x.bounds,value:x.value,ordinal}));
  function box(nodes:readonly {bounds:Bounds}[]):Bounds{
    return nodes.slice(1).reduce((b,n)=>unionBounds(b,n.bounds),nodes[0]!.bounds);
  }
  function leaf(chunks:Entry<T>[]):Node<T>{return {bounds:box(chunks),entries:chunks};}
  function group<U extends {bounds:Bounds}>(xs:readonly U[]):U[][]{
    const sorted=[...xs].sort((a,b)=>(a.bounds[0]+a.bounds[2])-(b.bounds[0]+b.bounds[2])||
      (a.bounds[1]+a.bounds[3])-(b.bounds[1]+b.bounds[3]));
    const slices=Math.ceil(Math.sqrt(sorted.length/bucketSize)),perSlice=Math.ceil(sorted.length/slices);
    const result:U[][]=[];
    for(let s=0;s<sorted.length;s+=perSlice){
      const stripe=sorted.slice(s,s+perSlice).sort((a,b)=>(a.bounds[1]+a.bounds[3])-(b.bounds[1]+b.bounds[3]));
      for(let j=0;j<stripe.length;j+=bucketSize)result.push(stripe.slice(j,j+bucketSize));
    }
    return result;
  }
  let nodes:Node<T>[] = entries.length?group(entries).map(leaf):[];
  while(nodes.length>1)nodes=group(nodes).map(children=>({bounds:box(children),children}));
  const root=nodes[0];
  return {
    query(bounds:Bounds):T[]{
      if(!root)return [];
      const found:Entry<T>[]=[],stack=[root];
      while(stack.length){
        const node=stack.pop()!;
        if(!intersects(node.bounds,bounds))continue;
        if(node.entries)for(const entry of node.entries)if(intersects(entry.bounds,bounds))found.push(entry);
        if(node.children)stack.push(...node.children);
      }
      found.sort((a,b)=>a.ordinal-b.ordinal);
      return found.map(e=>e.value);
    },
    get size(){return entries.length;}
  };
}
