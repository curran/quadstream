import { assertBounds } from './geometry.js';
import { buildTopology } from './topology.js';
import { buildSparseQuadtree } from './quadtree.js';
import { createSpatialIndex } from './spatial-index.js';
import { buildArcTrees, reconstructFeature } from './reconstruct.js';
import type { Bounds, Feature, FeatureCollection, QueryOptions, QueryResult, SparseQuadtree, Topology } from './types.js';
import type { BlgTree } from './blg.js';

export class QuadstreamDataset {
  readonly topology:Topology;
  readonly quadtree:SparseQuadtree;
  readonly arcTrees:readonly BlgTree[];
  private readonly featureIndex:ReturnType<typeof createSpatialIndex<number>>;
  constructor(input:FeatureCollection,{maxLevel=20}:{maxLevel?:number}={}){
    this.topology=buildTopology(input);
    this.quadtree=buildSparseQuadtree(this.topology.vertices,this.topology.bounds,maxLevel);
    this.arcTrees=buildArcTrees(this.topology.arcs,this.quadtree.levelByVertexId);
    this.featureIndex=createSpatialIndex(this.topology.features.map((f,i)=>({bounds:f.bounds,value:i})));
  }
  query(options:QueryOptions={}):QueryResult{
    const level=options.level??this.quadtree.maxLevel-1;
    if(!Number.isInteger(level)||level<0||level>=this.quadtree.maxLevel)throw new Error('Invalid query level');
    if(options.bounds)assertBounds(options.bounds);
    const selected=options.bounds?this.featureIndex.query(options.bounds):this.topology.features.map((_,i)=>i);
    const coords=(id:number)=>{const v=this.topology.vertices[id];return v?[v.x,v.y] as const:undefined;};
    let total=0,invalid=false;
    let results=selected.map(i=>{
      const r=reconstructFeature(this.topology.features[i]!,this.topology.arcs,this.arcTrees,level,coords);
      total+=r.selectedVertices;
      if(!r.valid)invalid=true;
      return r.feature;
    });
    if(invalid && options.validate!==false){
      // Conservative global fallback keeps *all* shared boundaries consistent.
      results=selected.map(i=>reconstructFeature(
        this.topology.features[i]!,this.topology.arcs,this.arcTrees,
        Infinity,coords).feature);
      total=results.reduce((n,f)=>n+coordinateCount(f),0);
    }
    return {geojson:{type:'FeatureCollection',features:results},level,
      usedFallback:invalid && options.validate!==false,
      selectedFeatures:results.length,selectedVertices:total};
  }
}
export function buildQuadstream(input:FeatureCollection,options?:{maxLevel?:number}):QuadstreamDataset{
  return new QuadstreamDataset(input,options);
}
function coordinateCount(feature:Feature):number{
  const g=feature.geometry;
  switch(g.type){
    case 'Polygon':return g.coordinates.reduce((n,r)=>n+r.length,0);
    case 'MultiPolygon':return g.coordinates.reduce((n,p)=>n+p.reduce((m,r)=>m+r.length,0),0);
    case 'LineString':return g.coordinates.length;
    case 'MultiLineString':return g.coordinates.reduce((n,r)=>n+r.length,0);
  }
}
