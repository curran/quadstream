import { assertBounds } from './geometry.js';
import type { Bounds, QuadCell, SparseQuadtree, Vertex } from './types.js';

export function cellKey(level:number,i:number,j:number):string {return `${level}_${i}_${j}`;}
export function cellAddress(x:number,y:number,bounds:Bounds,level:number):{i:number;j:number}{
  assertBounds(bounds);
  if(!Number.isInteger(level) || level<0 || level>25) throw new Error('Quadtree level must be 0..25');
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Nonfinite coordinate');
  const [minX,minY,maxX,maxY]=bounds;
  if(x<minX || x>maxX || y<minY || y>maxY)throw new Error('Point outside quadtree bounds');
  const side=2**level;
  const i=minX===maxX?0:Math.min(side-1,Math.floor((x-minX)/(maxX-minX)*side));
  const j=minY===maxY?0:Math.min(side-1,Math.floor((y-minY)/(maxY-minY)*side));
  return {i,j};
}
/** Assign each distinct vertex to the first unoccupied quadtree cell, coarse to fine. */
export function buildSparseQuadtree(vertices:readonly Vertex[],bounds:Bounds,maxLevel=20):SparseQuadtree{
  assertBounds(bounds);
  if(!Number.isInteger(maxLevel)||maxLevel<1||maxLevel>26)throw new Error('maxLevel must be 1..26');
  const sorted=[...vertices].sort((a,b)=>Number(b.critical)-Number(a.critical)||a.x-b.x||a.y-b.y||a.id-b.id);
  const occupied=new Set<string>(),cells:QuadCell[]=[],levelByVertexId:number[]=[];
  for(const v of sorted){
    let inserted=false;
    for(let level=0;level<maxLevel;level++){
      const {i,j}=cellAddress(v.x,v.y,bounds,level),key=cellKey(level,i,j);
      if(occupied.has(key))continue;
      occupied.add(key);cells.push({vertexId:v.id,level,i,j,key});
      levelByVertexId[v.id]=level;
      inserted=true;break;
    }
    if(!inserted)throw new Error(`Quadtree capacity exceeded at vertex ${v.id}; increase maxLevel`);
  }
  cells.sort((a,b)=>a.level-b.level||a.i-b.i||a.j-b.j||a.vertexId-b.vertexId);
  return {bounds,maxLevel,cells,levelByVertexId};
}
