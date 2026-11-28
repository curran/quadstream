import test from "node:test";
import assert from "node:assert/strict";
import { sphericalConnectedComponents, buildRobustSphericalGroups } from "../dist/index.js";
const feature = (coordinates) => ({type:"Feature",properties:{},geometry:{type:"LineString",coordinates}});
const source = {type:"FeatureCollection",features:[feature([[0,0],[1,0]]),feature([[1,0],[2,0]]),feature([[10,0],[11,0]])]};
test("connected failed features stay together; independent features survive", () => {
  assert.deepEqual(sphericalConnectedComponents(source.features), [[0,1],[2]]);
  const result = buildRobustSphericalGroups(source,{build:indices=>indices.includes(0)?{indices,error:"invalid"}:{indices,engine:true}});
  assert.deepEqual(result.groups.map(g=>g.indices),[[0,1],[2]]);
  assert.equal(result.unavailable,2);
});
