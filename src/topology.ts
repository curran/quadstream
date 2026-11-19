import { assertPosition, boundsOf, simpleClosedRing, validPolygon, unionBounds } from './geometry.js';
import type { Arc, Bounds, FeatureCollection, GeometryType, Position, Topology, TopologyFeature, Vertex } from './types.js';

type RawPath = { ids: number[]; closed: boolean };
interface PendingFeature {
  id: string; properties: Record<string,unknown>; geometryType: GeometryType;
  paths: RawPath[]; groups: number[][]; bounds: Bounds;
}
/** Exact coordinate topology: no implicit snapping, deduping almost-equal points, or antimeridian wrapping. */
export function buildTopology(input: FeatureCollection): Topology {
  if (!input || input.type!=='FeatureCollection' || !Array.isArray(input.features))
    throw new Error('Expected a GeoJSON FeatureCollection');
  if (!input.features.length) throw new Error('Empty FeatureCollection is not supported');
  const vertices: Vertex[] = [], byLocation=new Map<string,number>(), features: PendingFeature[]=[];
  const featureIds=new Set<string>();
  let overall: Bounds | undefined;
  function vertexId(p: Position): number {
    const [x,y]=assertPosition(p), key=JSON.stringify([x,y]);
    const existing=byLocation.get(key);
    if (existing!==undefined) return existing;
    const id=vertices.length; vertices.push({id,x,y,critical:false}); byLocation.set(key,id); return id;
  }
  for (let f=0;f<input.features.length;f++) {
    const feature=input.features[f]!;
    if (!feature || feature.type!=='Feature' || !feature.geometry || typeof feature.geometry!=='object')
      throw new Error(`Feature ${f} must have a supported geometry`);
    const id=String(feature.id??f);
    if(featureIds.has(id)) throw new Error(`Duplicate feature id: ${id}`);
    featureIds.add(id);
    const {type,coordinates}=feature.geometry;
    if(!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(type))
      throw new Error(`Unsupported geometry: ${type}`);
    const paths:RawPath[]=[],groups:number[][]=[];
    function append(coords: Position[],closed: boolean): void {
      if(!Array.isArray(coords)) throw new Error('Invalid coordinate path');
      const pts=coords.map(assertPosition);
      if(closed) {
        if(pts.length>=2 && pts[0]![0]===pts.at(-1)![0] && pts[0]![1]===pts.at(-1)![1]) pts.pop();
        if(new Set(pts.map(p=>JSON.stringify(p))).size<3 || !simpleClosedRing([...pts,pts[0]!]))
          throw new Error(`Invalid or self-intersecting source polygon ring in feature ${id}`);
      } else if(pts.length<2) throw new Error(`Line requires >=2 coordinates in feature ${id}`);
      const ids=pts.map(vertexId);
      paths.push({ids,closed});
    }
    if(type==='Polygon') {
      const group:number[]=[];
      for(const ring of coordinates as Position[][]) {group.push(paths.length);append(ring,true);}
      if(!group.length || !validPolygon((coordinates as Position[][]).map(r=>{
        const pts=r.map(assertPosition);return pts[0]![0]===pts.at(-1)![0] && pts[0]![1]===pts.at(-1)![1] ? pts : [...pts,pts[0]!];
      }))) throw new Error(`Invalid polygon (possibly hole containment): ${id}`);
      groups.push(group);
    } else if(type==='MultiPolygon') {
      for(const polygon of coordinates as Position[][][]) {
        const group:number[]=[];
        for(const ring of polygon){ group.push(paths.length);append(ring,true); }
        groups.push(group);
        if(!validPolygon(polygon.map(r=>{
          const pts=r.map(assertPosition);return pts[0]![0]===pts.at(-1)![0] && pts[0]![1]===pts.at(-1)![1] ? pts:[...pts,pts[0]!];
        }))) throw new Error(`Invalid multipolygon component: ${id}`);
      }
      if(!groups.length) throw new Error(`Empty multipolygon: ${id}`);
    } else if(type==='LineString') {
      append(coordinates as Position[],false); groups.push([0]);
    } else {
      for(const line of coordinates as Position[][]){const i=paths.length;append(line,false);groups.push([i]);}
      if(!groups.length) throw new Error(`Empty multiline: ${id}`);
    }
    const all=paths.flatMap(path=>path.ids.map(i=>[vertices[i]!.x,vertices[i]!.y] as Position));
    const b=boundsOf(all);overall=overall?unionBounds(overall,b):b;
    features.push({id,properties:{...(feature.properties??{})},geometryType:type,paths,groups,bounds:b});
  }
  const edgeOwners=new Map<string,Set<number>>(),neighbors=new Map<number,Set<number>>();
  const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  let pathNumber=0;
  for (const f of features) for(const path of f.paths){
    const n=path.ids.length,limit=path.closed?n:n-1;
    if(!path.closed){ vertices[path.ids[0]!]!.critical=true;vertices[path.ids[n-1]!]!.critical=true; }
    if(path.closed){
      // Three stable anchors avoid collapsing an entire closed ring to one point.
      for(const i of [0,Math.floor(n/3),Math.floor(2*n/3)]) vertices[path.ids[i]!]!.critical=true;
    }
    for(let i=0;i<limit;i++){
      const a=path.ids[i]!,b=path.ids[(i+1)%n]!;
      if(a===b) continue;
      const key=edgeKey(a,b);
      if(!edgeOwners.has(key))edgeOwners.set(key,new Set());
      edgeOwners.get(key)!.add(pathNumber);
      if(!neighbors.has(a))neighbors.set(a,new Set());
      if(!neighbors.has(b))neighbors.set(b,new Set());
      neighbors.get(a)!.add(b);neighbors.get(b)!.add(a);
    }
    pathNumber++;
  }
  const incident=new Map<number,Set<string>>();
  for(const [edge,owners] of edgeOwners){
    const signature=[...owners].sort((a,b)=>a-b).join(',');
    const [a,b]=edge.split(':').map(Number);
    for(const id of [a!,b!]){
      if(!incident.has(id))incident.set(id,new Set());
      incident.get(id)!.add(signature);
    }
  }
  for(const v of vertices) if(neighbors.get(v.id)?.size!==2 || incident.get(v.id)?.size!==1) v.critical=true;
  const arcs:Arc[]=[],arcByKey=new Map<string,number>();
  function intern(ids:number[]):number {
    const forward=ids.join(','),backward=[...ids].reverse().join(',');
    const reversed=forward>backward,key=reversed?backward:forward;
    const existing=arcByKey.get(key);
    if(existing!==undefined) return reversed?-(existing+1):existing+1;
    const id=arcs.length;
    arcs.push({id,vertexIds:reversed?[...ids].reverse():[...ids]});
    arcByKey.set(key,id);
    return reversed?-(id+1):id+1;
  }
  const output:TopologyFeature[]=features.map(f=>({
    id:f.id,properties:f.properties,geometryType:f.geometryType,
    groups:f.groups,paths:[],bounds:f.bounds
  }));
  for(let fi=0;fi<features.length;fi++){
    const feature=features[fi]!,result=output[fi]!;
    for(const raw of feature.paths){
      let ids=[...raw.ids];
      if(raw.closed){
        // Ring is cyclic: align at a stable marked vertex, without changing direction.
        let anchor=0;
        for(let i=1;i<ids.length;i++)if(vertices[ids[i]!]!.critical && ids[i]!<ids[anchor]!)anchor=i;
        ids=[...ids.slice(anchor),...ids.slice(0,anchor)];
      }
      const refs:number[]=[], n=ids.length, total=raw.closed?n:n-1;
      let current=[ids[0]!];
      for(let i=1;i<=total;i++){
        const next=ids[i%n]!;current.push(next);
        if(vertices[next]!.critical || i===total){
          if(current.length>1)refs.push(intern(current));
          current=[next];
        }
      }
      result.paths.push({closed:raw.closed,arcs:refs});
    }
  }
  return {vertices,arcs,features:output,bounds:overall!};
}
