import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuadstream, buildTopology, buildSparseQuadtree, buildBlgTree,
  selectBlgPositions, assertBlgInvariants, cellAddress, createSpatialIndex,
  validPolygon, simpleClosedRing, exportPartitions, encodePartition, decodePartition,
  checksum, QuadstreamSession, requiredPartitionKeys, intersects
} from '../dist/index.js';

const rect=(id,x0,y0,x1,y1)=>({type:'Feature',id,properties:{label:id},geometry:{
  type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}});
const collection=(...features)=>({type:'FeatureCollection',features});
const c=collection(rect('west',0,0,10,10),rect('east',10,0,20,10));
const coords=(p)=>p.geometry.coordinates;
function closedEdges(ring){
  const edges=[];
  for(let i=0;i<ring.length-1;i++){
    const p=ring[i],q=ring[i+1];
    edges.push([JSON.stringify(p),JSON.stringify(q)].sort().join('~'));
  }
  return edges.sort();
}
function normalizedCycle(ring){
  const pts=ring.slice(0,-1),keys=pts.map(JSON.stringify);
  const shifts=keys.map((_,i)=>[...keys.slice(i),...keys.slice(0,i)].join('|'));
  return shifts.sort()[0];
}
function seeded(seed){let x=seed|0;return ()=>{x ^= x<<13;x ^= x>>>17;x ^= x<<5;return (x>>>0)/2**32;};}

test('topology shares exact reverse-facing arcs across adjacent polygons',()=>{
  const t=buildTopology(c);
  assert.equal(t.features.length,2);
  assert.equal(t.vertices.length,6);
  assert.equal(t.features[0].geometryType,'Polygon');
  const refs=t.features.map(f=>new Set(f.paths.flatMap(p=>p.arcs).map(Math.abs)));
  const shared=[...refs[0]].filter(v=>refs[1].has(v));
  assert.ok(shared.length>=1,'shared boundary interned once');
  const west=t.features[0].paths[0].arcs;
  const east=t.features[1].paths[0].arcs;
  assert.ok(west.some(r=>east.includes(-r)),'same shared arc with reversed orientation');
});

test('full detail exactly recovers original cyclic paths',()=>{
  const dataset=buildQuadstream(c,{maxLevel:12});
  const result=dataset.query({level:11});
  assert.equal(result.usedFallback,false);
  for(let i=0;i<2;i++){
    assert.equal(normalizedCycle(coords(result.geojson.features[i])[0]),
      normalizedCycle(coords(c.features[i])[0]));
  }
});

test('all supported geometry forms, holes, and multiline are reconstructed',()=>{
  const fc=collection(
    {type:'Feature',id:'hole',properties:null,geometry:{type:'Polygon',coordinates:[
      [[0,0],[20,0],[20,20],[0,20],[0,0]],
      [[6,6],[6,12],[12,12],[12,6],[6,6]]]}},
    {type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:[[30,0],[31,5],[32,0]]}},
    {type:'Feature',id:'multi-line',properties:{},geometry:{type:'MultiLineString',coordinates:[[[40,0],[50,0]],[[40,1],[50,1]]]}},
    {type:'Feature',id:'multi-poly',properties:{},geometry:{type:'MultiPolygon',coordinates:[
      [[[60,0],[65,0],[65,5],[60,5],[60,0]]],
      [[[70,0],[75,0],[75,5],[70,5],[70,0]]]
    ]}}
  );
  const ds=buildQuadstream(fc,{maxLevel:14});
  const out=ds.query({level:13});
  assert.deepEqual(out.geojson.features.map(f=>f.geometry.type),fc.features.map(f=>f.geometry.type));
  assert.equal(out.usedFallback,false);
  assert.equal(out.geojson.features[0].geometry.coordinates.length,2);
  assert.equal(out.geojson.features[2].geometry.coordinates.length,2);
  assert.equal(out.geojson.features[3].geometry.coordinates.length,2);
});

test('invalid topology and unsupported inputs reject without silent data loss',()=>{
  assert.throws(()=>buildTopology(collection(rect('a',0,0,1,1),rect('a',2,2,3,3))),/Duplicate feature/);
  assert.throws(()=>buildTopology(collection({type:'Feature',id:'x',properties:{},geometry:{type:'Point',coordinates:[1,2]}})),/Unsupported/);
  assert.throws(()=>buildTopology(collection({type:'Feature',id:'x',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}})),/Invalid/);
  assert.throws(()=>buildTopology(collection({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[1,2]]}})),/Line requires/);
  assert.throws(()=>buildTopology(collection({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[Infinity,2],[3,4]]}})),/finite planar/);
  assert.throws(()=>buildTopology(collection({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[1,2,3],[3,4,5]]}})),/finite planar/);
  assert.equal(validPolygon([[[0,0],[2,0],[2,2],[0,2],[0,0]],[[3,3],[3,4],[4,4],[4,3],[3,3]]]),false);
  assert.equal(simpleClosedRing([[0,0],[1,0],[0,0]]),false);
});

test('sparse quadtree deterministic occupancy and boundary clamping',()=>{
  assert.deepEqual(cellAddress(10,10,[0,0,10,10],3),{i:7,j:7});
  assert.deepEqual(cellAddress(0,0,[0,0,10,10],3),{i:0,j:0});
  assert.deepEqual(cellAddress(5,5,[0,0,10,10],3),{i:4,j:4});
  assert.throws(()=>cellAddress(11,0,[0,0,10,10],0),/outside/);
  const v=Array.from({length:100},(_,id)=>({id,x:id/100,y:(id*37%101)/101,critical:id%17===0}));
  const q=buildSparseQuadtree(v,[0,0,1,1],12),q2=buildSparseQuadtree(v,[0,0,1,1],12);
  assert.deepEqual(q,q2);
  assert.equal(q.cells.length,v.length);
  assert.equal(new Set(q.cells.map(cell=>cell.key)).size,v.length);
  assert.throws(()=>buildSparseQuadtree(v,[0,0,1,1],1),/capacity/);
});

test('BLG tree preserves every index and nested selections across levels',()=>{
  const levels=[0,7,3,8,2,9,4,1,5,6,0];
  const tree=buildBlgTree(levels);
  assertBlgInvariants(tree);
  assert.deepEqual(selectBlgPositions(tree,Infinity),levels.map((_,i)=>i));
  let prior=new Set();
  for(let level=0;level<10;level++){
    const next=new Set(selectBlgPositions(tree,level));
    assert.ok([...prior].every(x=>next.has(x)));
    assert.ok([...next].every(i=>levels[i]<=level));
    prior=next;
  }
  assert.deepEqual(selectBlgPositions(tree,9),levels.map((_,i)=>i));
  assert.throws(()=>buildBlgTree([0,-1]),/nonnegative/);
});

test('BLG handles long sorted and equal-level sequences without recursion',()=>{
  for(const levels of [Array(40000).fill(2),Array.from({length:40000},(_,i)=>i),
      Array.from({length:40000},(_,i)=>40000-i)]){
    const tree=buildBlgTree(levels);assertBlgInvariants(tree);
    assert.equal(selectBlgPositions(tree,Infinity).length,40000);
  }
});

test('packed spatial index equals a brute-force scan for randomized bounding boxes',()=>{
  const rng=seeded(42),items=[];
  for(let i=0;i<1000;i++){
    const x=rng()*100,y=rng()*100,w=rng()*10,h=rng()*10;
    items.push({bounds:[x,y,x+w,y+h],value:i});
  }
  const index=createSpatialIndex(items,8);
  assert.equal(index.size,1000);
  for(let i=0;i<200;i++){
    const x=rng()*110,y=rng()*110,bounds=[x,y,x+rng()*15,y+rng()*15];
    assert.deepEqual(index.query(bounds),items.filter(e=>intersects(e.bounds,bounds)).map(e=>e.value));
  }
  assert.deepEqual(createSpatialIndex([]).query([0,0,1,1]),[]);
});

test('viewport queries match feature bbox scans',()=>{
  const ds=buildQuadstream(c,{maxLevel:14});
  assert.deepEqual(ds.query({bounds:[-1,-1,9,9],level:13}).geojson.features.map(f=>f.id),['west']);
  assert.deepEqual(ds.query({bounds:[10,0,10,10],level:13}).geojson.features.map(f=>f.id),['west','east']);
  assert.deepEqual(ds.query({bounds:[100,100,101,101]}).geojson.features,[]);
  assert.throws(()=>ds.query({level:14}),/Invalid query level/);
});

test('binary partition roundtrip, checksum, version and length validation',()=>{
  const input=[{id:1,x:-11.125,y:1e-9,level:3},{id:9,x:2,y:20,level:13}];
  const bytes=encodePartition(input);
  assert.deepEqual(decodePartition(bytes),input);
  assert.equal(checksum(bytes),checksum(new Uint8Array(bytes)));
  assert.throws(()=>decodePartition(bytes.subarray(0,10)),/length/);
  const altered=new Uint8Array(bytes);altered[4]=42;
  assert.throws(()=>decodePartition(altered),/version/);
  assert.throws(()=>encodePartition([{id:-1,x:0,y:0,level:0}]),/Invalid/);
  assert.throws(()=>decodePartition(new Uint8Array([1,2,3,4])),/magic/);
});

test('manifest partitions account for every vertex, deterministic bytes, and session convergence',()=>{
  const ds=buildQuadstream(c,{maxLevel:10});
  const a=exportPartitions(ds,{fileDepth:3}),b=exportPartitions(ds,{fileDepth:3});
  assert.deepEqual(a.manifest,b.manifest);
  assert.deepEqual([...a.partitions].map(([k,v])=>[k,[...v]]),[...b.partitions].map(([k,v])=>[k,[...v]]));
  const allIds=a.manifest.partitions.flatMap(p=>p.vertexIds);
  assert.equal(allIds.length,new Set(allIds).size);
  assert.equal(allIds.length,ds.topology.vertices.length);
  assert.equal(a.manifest.partitions[0].key,'base');
  const session=new QuadstreamSession(a.manifest);
  assert.ok(session.missingKeys(9).length);
  assert.equal(session.query({level:9}).complete,false);
  const entries=[...a.partitions].reverse();
  for(const [key,bytes] of entries){
    if(key==='base')continue;
    assert.equal(session.load(key,bytes),true);
    assert.equal(session.load(key,bytes),false);
  }
  assert.ok(session.missingKeys(9).includes('base'));
  session.load('base',a.partitions.get('base'));
  assert.deepEqual(session.missingKeys(9),[]);
  const recovered=session.query({level:9});
  assert.equal(recovered.complete,true);
  assert.deepEqual(recovered.geojson,ds.query({level:9}).geojson);
  assert.deepEqual(requiredPartitionKeys(a.manifest,9).sort(),[...a.partitions.keys()].sort());
});

test('tampering, unknown partitions, duplicate manifest vertex IDs fail before mutation',()=>{
  const ds=buildQuadstream(c,{maxLevel:12}),bundle=exportPartitions(ds);
  const session=new QuadstreamSession(bundle.manifest);
  const [key,bytes]=[...bundle.partitions][0];
  const modified=new Uint8Array(bytes);modified[modified.length-1]^=1;
  assert.throws(()=>session.load(key,modified),/checksum/);
  assert.deepEqual(session.loadedKeys,[]);
  assert.throws(()=>session.load('unknown',bytes),/Unknown partition/);
  const bad=structuredClone(bundle.manifest);
  bad.partitions[0].vertexIds.push(bad.partitions[1]?.vertexIds?.[0]??bad.partitions[0].vertexIds[0]);
  assert.throws(()=>new QuadstreamSession(bad),/assigned to multiple|accounting mismatch/);
});

test('randomized simple polygon runs retain all source vertices at full detail',()=>{
  const rng=seeded(999);
  for(let i=0;i<150;i++){
    const sides=4+Math.floor(rng()*16),cx=rng()*100,cy=rng()*100,radius=1+rng()*9;
    const pts=Array.from({length:sides},(_,j)=>[
      cx+radius*Math.cos(2*Math.PI*j/sides),cy+radius*Math.sin(2*Math.PI*j/sides)]);
    const source=collection({type:'Feature',id:'poly',properties:{},geometry:{type:'Polygon',coordinates:[[...pts,pts[0]]]}});
    const ds=buildQuadstream(source,{maxLevel:20});
    const out=ds.query({level:19});
    assert.equal(out.usedFallback,false,`seed case ${i}`);
    assert.equal(normalizedCycle(out.geojson.features[0].geometry.coordinates[0]),
      normalizedCycle(source.features[0].geometry.coordinates[0]));
  }
});

test('shared-arc reconstruction remains identical under mixed simplification levels',()=>{
  const left={type:'Feature',id:'left',properties:{},geometry:{type:'Polygon',coordinates:[[
    [0,0],[10,0],[10,2],[10,4],[10,6],[10,8],[10,10],[0,10],[0,0]]]}};
  const right={type:'Feature',id:'right',properties:{},geometry:{type:'Polygon',coordinates:[[
    [10,10],[10,8],[10,6],[10,4],[10,2],[10,0],[20,0],[20,10],[10,10]]]}};
  const ds=buildQuadstream(collection(left,right),{maxLevel:12});
  const t=ds.topology;
  const refL=t.features[0].paths[0].arcs;
  const refR=t.features[1].paths[0].arcs;
  const shared=refL.filter(r=>refR.includes(-r));
  assert.ok(shared.length>=1);
  for(let level=0;level<12;level++){
    const out=ds.query({level});
    assert.equal(out.geojson.features.length,2);
    for(const f of out.geojson.features)assert.equal(validPolygon(f.geometry.coordinates),true);
    const a=out.geojson.features[0].geometry.coordinates[0];
    const b=out.geojson.features[1].geometry.coordinates[0];
    const leftSegments=new Set(closedEdges(a)),rightSegments=new Set(closedEdges(b));
    assert.ok([...leftSegments].some(edge=>rightSegments.has(edge)));
  }
});

test('quadtree vertex assignment invariant under permutation with distinct coordinates',()=>{
  const rng=seeded(1299);
  const v=Array.from({length:320},(_,id)=>({id,x:rng(),y:rng(),critical:id%23===0}));
  const base=buildSparseQuadtree(v,[0,0,1,1],18);
  const shuffled=[...v].reverse().map((x,id)=>({...x,id}));
  const other=buildSparseQuadtree(shuffled,[0,0,1,1],18);
  const byCoord=(vertices,tree)=>Object.fromEntries(vertices.map(x=>[`${x.x}:${x.y}`,tree.levelByVertexId[x.id]]));
  assert.deepEqual(byCoord(v,base),byCoord(shuffled,other));
});

test('every query level converges to synchronous dataset after loading all partitions',()=>{
  const source=collection(rect('a',0,0,10,10),rect('b',10,0,20,10),rect('c',20,0,30,10));
  const ds=buildQuadstream(source,{maxLevel:14});
  const {manifest,partitions}=exportPartitions(ds,{fileDepth:2});
  const session=new QuadstreamSession(structuredClone(manifest));
  for(const [key,bytes] of [...partitions].reverse())session.load(key,bytes);
  for(let level=0;level<manifest.maxLevel;level++){
    const expected=ds.query({level});
    const got=session.query({level});
    assert.equal(got.complete,true,`level ${level}`);
    assert.equal(got.usedFallback,expected.usedFallback,`fallback level ${level}`);
    assert.deepEqual(got.geojson,expected.geojson);
  }
});

test('partition decoding rejects truncated and extra trailing records, and handles subarray offsets',()=>{
  const bytes=encodePartition([{id:0,x:0,y:-0,level:0},{id:8,x:2.5,y:3.5,level:18}]);
  const padded=new Uint8Array(bytes.length+9);
  padded.set(bytes,4);
  assert.deepEqual(decodePartition(padded.subarray(4,4+bytes.length)),decodePartition(bytes));
  assert.throws(()=>decodePartition(padded.subarray(4)),/length/);
  const bogus=new Uint8Array(bytes);new DataView(bogus.buffer).setUint32(6,0xffffffff,true);
  assert.throws(()=>decodePartition(bogus,1000),/limit/);
});

test('geometry rejects holes that cross their enclosing ring and preserves well-formed holes',()=>{
  const outer=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  const within=[[2,2],[2,5],[5,5],[5,2],[2,2]];
  const crossing=[[8,8],[12,8],[12,12],[8,12],[8,8]];
  assert.equal(validPolygon([outer,within]),true);
  assert.equal(validPolygon([outer,crossing]),false);
  assert.throws(()=>buildQuadstream(collection({type:'Feature',id:'bad',properties:{},
    geometry:{type:'Polygon',coordinates:[outer,crossing]}})),/Invalid polygon/);
});

test('fallback is consistent across separate viewports and partial feature selections',()=>{
  const source=collection(
    {type:'Feature',id:'with-hole',properties:{},geometry:{type:'Polygon',coordinates:[
      [[0,0],[20,0],[20,20],[0,20],[0,0]],
      [[2,3],[2,5],[4,5],[4,3],[2,3]]
    ]}},
    rect('separate',100,0,110,10)
  );
  const ds=buildQuadstream(source,{maxLevel:12});
  const global=ds.query({level:0});
  const remoteOnly=ds.query({level:0,bounds:[99,-1,111,11]});
  assert.equal(global.usedFallback,true,'invalid simplified hole triggers fallback');
  assert.equal(remoteOnly.usedFallback,true,'separate viewport makes same global decision');
  assert.equal(remoteOnly.geojson.features.length,1);
  assert.deepEqual(remoteOnly.geojson.features[0],ds.query({level:11,bounds:[99,-1,111,11]}).geojson.features[0]);
  const {manifest,partitions}=exportPartitions(ds,{fileDepth:3});
  const session=new QuadstreamSession(manifest);
  for(const [key,bytes] of partitions)session.load(key,bytes);
  const streamed=session.query({level:0,bounds:[99,-1,111,11]});
  assert.equal(streamed.complete,true);
  assert.equal(streamed.usedFallback,true);
  assert.deepEqual(streamed.geojson,remoteOnly.geojson);
});

test('degenerate zero-length input lines do not silently enter topology',()=>{
  assert.throws(()=>buildTopology(collection({type:'Feature',properties:{},geometry:{
    type:'LineString',coordinates:[[5,7],[5,7]]}})),/distinct coordinates/);
});

test('lazy loader fetches only needed levels and reuses validated session state',async()=>{
  const {QuadstreamLoader,fetchFromBundle}=await import('../dist/index.js');
  const line=Array.from({length:80},(_,i)=>[i,Math.sin(i/5)*20]);
  const source=collection({type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:line}});
  const ds=buildQuadstream(source,{maxLevel:16});
  const bundle=exportPartitions(ds,{fileDepth:1});
  assert.ok(bundle.partitions.size>1);
  const session=new QuadstreamSession(bundle.manifest);
  const calls=[];
  const fetcher=async(key,opts)=>{calls.push(key);return fetchFromBundle(bundle)(key,opts);};
  const loader=new QuadstreamLoader(session,fetcher,{concurrency:2,cacheBytes:10000});
  await loader.ensureLevel(0);
  assert.deepEqual(calls,requiredPartitionKeys(bundle.manifest,0));
  assert.ok(loader.cacheSizeBytes<=10000);
  await loader.ensureLevel(0);
  assert.deepEqual(calls,requiredPartitionKeys(bundle.manifest,0));
  const result=await loader.loadLatest({level:15});
  assert.equal(result.complete,true);
  assert.deepEqual(result.geojson,ds.query({level:15}).geojson);
  assert.equal(new Set(calls).size,bundle.partitions.size);
  assert.equal(loader.session.loadedKeys.length,bundle.partitions.size);
});

test('loader respects concurrency limits and propagates fetch corruption',async()=>{
  const {QuadstreamLoader,fetchFromBundle}=await import('../dist/index.js');
  const source=collection({type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:
    Array.from({length:200},(_,i)=>[i,Math.cos(i/10)*i])}});
  const bundle=exportPartitions(buildQuadstream(source,{maxLevel:18}),{fileDepth:1});
  let inFlight=0,highWater=0;
  const session=new QuadstreamSession(bundle.manifest);
  const loader=new QuadstreamLoader(session,async(key,opts)=>{
    highWater=Math.max(highWater,++inFlight);
    await new Promise(r=>setTimeout(r,1));
    inFlight--;
    return fetchFromBundle(bundle)(key,opts);
  },{concurrency:2,cacheBytes:100});
  await loader.ensureLevel(17);
  assert.ok(highWater<=2 && highWater>=1);
  assert.ok(loader.cacheSizeBytes<=100);
  const brokenSession=new QuadstreamSession(bundle.manifest);
  const brokenLoader=new QuadstreamLoader(brokenSession,async(key,opts)=>{
    const bytes=await fetchFromBundle(bundle)(key,opts);
    bytes[bytes.length-1]^=1;return bytes;
  });
  await assert.rejects(brokenLoader.ensureLevel(0),/checksum/);
  assert.deepEqual(brokenSession.loadedKeys,[]);
  assert.throws(()=>new QuadstreamLoader(session,fetchFromBundle(bundle),{concurrency:0}),/concurrency/);
});

test('latest-view cancellation prevents stale fetch results from being applied',async()=>{
  const {QuadstreamLoader,fetchFromBundle}=await import('../dist/index.js');
  const source=collection({type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:
    Array.from({length:100},(_,i)=>[i,i*i])}});
  const bundle=exportPartitions(buildQuadstream(source,{maxLevel:16}),{fileDepth:1});
  let resolveFirst;
  let attempts=0;
  const fetcher=async(key,opts)=>{
    attempts++;
    if(attempts===1)await new Promise(r=>resolveFirst=r);
    return fetchFromBundle(bundle)(key,opts);
  };
  const session=new QuadstreamSession(bundle.manifest),loader=new QuadstreamLoader(session,fetcher,{concurrency:1});
  const stale=loader.loadLatest({level:15});
  await Promise.resolve();
  const current=loader.loadLatest({level:0});
  resolveFirst();
  await assert.rejects(stale,{name:'AbortError'});
  const result=await current;
  assert.equal(result.level,0);
  assert.equal(result.complete,true);
  assert.equal(session.loadedKeys.includes('base'),true);
});

test('aborted loader request rejects even when a custom fetcher ignores AbortSignal',async()=>{
  const {QuadstreamLoader}=await import('../dist/index.js');
  const source=collection({type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[10,5],[20,0]]}});
  const bundle=exportPartitions(buildQuadstream(source,{maxLevel:10}),{fileDepth:1});
  const session=new QuadstreamSession(bundle.manifest);
  let pending;
  const loader=new QuadstreamLoader(session,()=>new Promise(resolve=>{pending=resolve;}));
  const ctl=new AbortController();
  const work=loader.ensureLevel(9,{signal:ctl.signal});
  ctl.abort();
  await assert.rejects(work,{name:'AbortError'});
  assert.deepEqual(session.loadedKeys,[]);
  pending(bundle.partitions.values().next().value);
  await Promise.resolve();
  assert.deepEqual(session.loadedKeys,[]);
});
