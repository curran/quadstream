import test from "node:test";
import assert from "node:assert/strict";
import { createLatestGeometry } from "../dist/index.js";
test("coalesces desired levels and ignores invalidated responses",async()=>{
  const requests=[],frames=[],pending=[];
  const s=createLatestGeometry({request:level=>new Promise(resolve=>{requests.push(level);pending.push(resolve);}),onFrame:f=>frames.push(f.level)});
  const first=s.select(1); await s.select(2); await s.select(3);
  pending.shift()({level:1,seq:1}); await Promise.resolve();
  assert.deepEqual(requests,[1,3]);
  pending.shift()({level:3,seq:2}); await first;
  assert.deepEqual(frames,[1,3]);
  const next=s.select(4);s.invalidate();pending.shift()({level:4,seq:3});await next;
  assert.deepEqual(frames,[1,3]);s.dispose();
});
