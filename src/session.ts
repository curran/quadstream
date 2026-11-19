import { assertBounds } from './geometry.js';
import { buildArcTrees, reconstructFeature } from './reconstruct.js';
import { createSpatialIndex } from './spatial-index.js';
import { decodePartition, checksum, requiredPartitionKeys } from './partition.js';
import type { Bounds, FeatureCollection, PartitionRecord, QuadstreamManifest, QueryOptions } from './types.js';

/** Progressive session: validates every partition before changing observable state. */
export class QuadstreamSession {
  readonly manifest:QuadstreamManifest;
  private readonly loaded=new Set<string>();
  private readonly vertices=new Map<number,PartitionRecord>();
  private readonly tree;
  private readonly featureIndex;
  private readonly partitionByKey;
  private readonly validityCache=new Map<number,boolean>();
  constructor(manifest:QuadstreamManifest){
    if(manifest?.format!=='quadstream'||manifest.version!==1||!Array.isArray(manifest.partitions))
      throw new Error('Unsupported Quadstream manifest');
    this.manifest=manifest;
    this.tree=buildArcTrees(manifest.arcs,manifest.vertices.map(v=>v.level));
    this.featureIndex=createSpatialIndex(manifest.features.map((f,i)=>({bounds:f.bounds,value:i})));
    this.partitionByKey=new Map(manifest.partitions.map(p=>[p.key,p]));
    if(this.partitionByKey.size!==manifest.partitions.length)throw new Error('Duplicate partition keys');
    const ids=new Set<number>();
    for(const p of manifest.partitions)for(const id of p.vertexIds){
      if(ids.has(id))throw new Error('Vertex assigned to multiple partitions');ids.add(id);
    }
    if(ids.size!==manifest.vertices.length)throw new Error('Manifest vertex accounting mismatch');
  }
  load(key:string,bytes:Uint8Array):boolean {
    const info=this.partitionByKey.get(key);
    if(!info)throw new Error(`Unknown partition: ${key}`);
    if(bytes.byteLength!==info.byteLength || checksum(bytes)!==info.checksum)
      throw new Error(`Partition checksum or length mismatch: ${key}`);
    if(this.loaded.has(key))return false;
    const records=decodePartition(bytes),expected=new Set(info.vertexIds),seen=new Set<number>();
    if(records.length!==expected.size)throw new Error('Partition count mismatch');
    for(const record of records){
      const meta=this.manifest.vertices[record.id];
      if(!expected.has(record.id)||seen.has(record.id)||!meta||meta.id!==record.id||meta.level!==record.level||this.vertices.has(record.id))
        throw new Error('Unexpected or duplicate partition vertex');
      seen.add(record.id);
    }
    for(const record of records)this.vertices.set(record.id,record);
    this.loaded.add(key);return true;
  }
  get loadedKeys():string[]{return [...this.loaded].sort();}
  missingKeys(level:number):string[]{return requiredPartitionKeys(this.manifest,level).filter(k=>!this.loaded.has(k));}
  query(options:QueryOptions={}):{
    geojson:FeatureCollection;complete:boolean;level:number;missingKeys:string[];
    omittedFeatures:number;selectedVertices:number;usedFallback:boolean
  } {
    const level=options.level??this.manifest.maxLevel-1;
    const missingKeys=this.missingKeys(level);
    if(options.bounds)assertBounds(options.bounds);
    const ids=options.bounds?this.featureIndex.query(options.bounds):this.manifest.features.map((_,i)=>i);
    const allLoaded=this.loaded.size===this.manifest.partitions.length;
    let globallyInvalid=false;
    if(allLoaded && options.validate!==false){
      const cached=this.validityCache.get(level);
      if(cached!==undefined)globallyInvalid=!cached;
      else{
        globallyInvalid=this.manifest.features.some(f=>!reconstructFeature(
          f,this.manifest.arcs,this.tree,level,id=>{
            const v=this.vertices.get(id);return v?[v.x,v.y] as const:undefined;
          }).valid);
        this.validityCache.set(level,!globallyInvalid);
      }
    }
    let omittedFeatures=0,selectedVertices=0;
    const features=[] as FeatureCollection['features'];
    for(const i of ids){
      const result=reconstructFeature(this.manifest.features[i]!,this.manifest.arcs,this.tree,
        globallyInvalid?Infinity:level,id=>{
          const v=this.vertices.get(id);return v?[v.x,v.y] as const:undefined;
        });
      if(!result.valid || result.missing){omittedFeatures++;continue;}
      selectedVertices+=result.selectedVertices;features.push(result.feature);
    }
    const usedFallback=globallyInvalid;
    return {geojson:{type:'FeatureCollection',features},complete:missingKeys.length===0&&omittedFeatures===0,
      missingKeys,level,omittedFeatures,selectedVertices,usedFallback};
  }
}
