import { QuadstreamSession } from './session.js';
import type { QueryOptions, PartitionBundle } from './types.js';

export type PartitionFetcher = (key:string,context:{signal:AbortSignal})=>Promise<Uint8Array>;
export interface LoaderOptions {
  /** Maximum concurrent fetches *per request*; default 4. */
  concurrency?: number;
  /** Limit for the optional raw-byte LRU. Parsed vertices remain in the session. */
  cacheBytes?: number;
}
function abortError():Error {
  const e=new Error('Quadstream load aborted');e.name='AbortError';return e;
}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)return Promise.reject(abortError());
  return new Promise<T>((resolve,reject)=>{
    const onAbort=()=>{signal.removeEventListener('abort',onAbort);reject(abortError());};
    signal.addEventListener('abort',onAbort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',onAbort);resolve(value);},
      error=>{signal.removeEventListener('abort',onAbort);reject(error);});
  });
}
/** Optional, transport-independent loader around a validated progressive session. */
export class QuadstreamLoader {
  private readonly concurrency:number;
  private readonly cacheLimit:number;
  private readonly cache=new Map<string,Uint8Array>();
  private cachedBytes=0;
  private latestRequest?:AbortController;
  constructor(
    readonly session:QuadstreamSession,
    private readonly fetchPartition:PartitionFetcher,
    options:LoaderOptions={}
  ) {
    const {concurrency=4,cacheBytes=16*1024*1024}=options;
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)
      throw new Error('concurrency must be an integer between 1 and 32');
    if(!Number.isSafeInteger(cacheBytes)||cacheBytes<0)
      throw new Error('cacheBytes must be a nonnegative safe integer');
    this.concurrency=concurrency;
    this.cacheLimit=cacheBytes;
  }
  get cachedPartitionKeys():string[]{return [...this.cache.keys()];}
  get cacheSizeBytes():number{return this.cachedBytes;}
  private remember(key:string,bytes:Uint8Array):void {
    if(bytes.byteLength>this.cacheLimit)return;
    const old=this.cache.get(key);
    if(old){this.cachedBytes-=old.byteLength;this.cache.delete(key);}
    this.cache.set(key,bytes.slice());this.cachedBytes+=bytes.byteLength;
    while(this.cachedBytes>this.cacheLimit){
      const oldest=this.cache.keys().next().value as string;
      this.cachedBytes-=this.cache.get(oldest)!.byteLength;
      this.cache.delete(oldest);
    }
  }
  /** Lazily fetch partitions required for this level. Already ingested keys are skipped. */
  async ensureLevel(level:number,options:{signal?:AbortSignal}={}):Promise<void>{
    const keys=this.session.missingKeys(level);
    if(!keys.length)return;
    const controller=new AbortController();
    const onAbort=()=>controller.abort();
    if(options.signal?.aborted)throw abortError();
    options.signal?.addEventListener('abort',onAbort,{once:true});
    let next=0;
    try{
      const worker=async():Promise<void>=>{
        while(next<keys.length){
          if(controller.signal.aborted)throw abortError();
          const key=keys[next++]!;
          try{
            let bytes=this.cache.get(key);
            if(bytes){
              this.cache.delete(key);this.cache.set(key,bytes); // refresh LRU
            } else{
              bytes=await abortable(this.fetchPartition(key,{signal:controller.signal}),controller.signal);
            }
            if(controller.signal.aborted)throw abortError();
            // load() validates checksum, length, record IDs, levels and duplicate records.
            this.session.load(key,bytes);
            this.remember(key,bytes);
          } catch(error){
            controller.abort();throw error;
          }
        }
      };
      await Promise.all(Array.from({length:Math.min(this.concurrency,keys.length)},()=>worker()));
    }finally{
      options.signal?.removeEventListener('abort',onAbort);
    }
  }
  /** Supersede the preceding latest-view request without clearing valid stored geometry. */
  async loadLatest(query:QueryOptions={}):Promise<ReturnType<QuadstreamSession['query']>>{
    this.latestRequest?.abort();
    const controller=new AbortController();this.latestRequest=controller;
    try{
      await this.ensureLevel(query.level??this.session.manifest.maxLevel-1,{signal:controller.signal});
      if(controller.signal.aborted)throw abortError();
      return this.session.query(query);
    }finally{
      if(this.latestRequest===controller)this.latestRequest=undefined;
    }
  }
  cancelLatest():void{this.latestRequest?.abort();}
}
/** In-memory adapter for examples and deterministic end-to-end tests. */
export function fetchFromBundle(bundle:PartitionBundle):PartitionFetcher {
  return async key=>{
    const bytes=bundle.partitions.get(key);
    if(!bytes)throw new Error(`Missing partition in bundle: ${key}`);
    return bytes.slice();
  };
}
