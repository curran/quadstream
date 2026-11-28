import test from "node:test";
import assert from "node:assert/strict";
import {createSphericalViewClipper} from "../dist/index.js";
const frame={type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}]};
const cone={vx:1,vy:0,vz:0,viewRadius:0.2};
test("padded window reuse, identity invalidation and cull fallback",()=>{
 const clip=createSphericalViewClipper();
 assert.equal(clip(frame,cone).stats.rebuilt,true);
 assert.equal(clip(frame,cone).stats.rebuilt,false);
 clip.invalidate();
 assert.equal(clip(frame,cone).stats.rebuilt,true);
 assert.equal(clip({...frame},cone).stats.rebuilt,true);
 assert.equal(clip(frame,{...cone,viewRadius:Math.PI/2}).stats.mode,"cull");
});
