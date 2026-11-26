import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLonLat,
  lonLatVector,
  angularDistance,
  sphericalCellAddress,
  buildSphericalPriorities,
  validGreatCirclePath,
  sphericalPolygonSignature,
  validSphericalPolygon,
  buildSphericalQuadstream,
  importSphericalTopoJSON,
  buildQuadstream,
  importTopoJSON,
  exportPartitions,
  QuadstreamSession,
  selectBlgPositions,
  assertBlgInvariants,
} from "../dist/index.js";

const feature = (geometry, id = "a", properties = {}) => ({
  type: "Feature",
  id,
  properties,
  geometry,
});
const fc = (...features) => ({ type: "FeatureCollection", features });
const polygon = (...coordinates) => ({ type: "Polygon", coordinates });
const line = (...coordinates) => ({ type: "LineString", coordinates });
const dateline = [
  [170, -10],
  [170, 10],
  [-170, 10],
  [-170, -10],
  [170, -10],
];
const pole = [
  [135, 80],
  [45, 80],
  [-45, 80],
  [-135, 80],
  [135, 80],
];
const shell = [
  [-20, -20],
  [-20, 20],
  [20, 20],
  [20, -20],
  [-20, -20],
];
const hole = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
  [-5, -5],
];
function ringKey(ring) {
  const seq = ring.slice(0, -1).map(canonicalLonLat).map(JSON.stringify);
  return seq
    .map((_, i) => seq.slice(i).concat(seq.slice(0, i)).join("|"))
    .sort()[0];
}
function vertex(id, x, y, critical = false) {
  return { id, x, y, critical };
}

test("exact longitude seam and pole aliases, without snapping neighboring positions", () => {
  assert.deepEqual(canonicalLonLat([180, -0]), [-180, 0]);
  assert.deepEqual(canonicalLonLat([-180, 0]), [-180, 0]);
  assert.deepEqual(canonicalLonLat([123, 90]), [0, 90]);
  assert.deepEqual(canonicalLonLat([-45, -90]), [0, -90]);
  assert.notDeepEqual(canonicalLonLat([179.999999, 0]), [-180, 0]);
  assert.deepEqual(lonLatVector([20, 90]), [0, 0, 1]);
});
test("reject invalid geographic coordinates and extra dimensions", () => {
  for (const v of [
    [181, 0],
    [0, 91],
    [-181, 0],
    [0, -91],
    [NaN, 0],
    [0, Infinity],
    [1, 2, 3],
    null,
    ["1", 2],
  ])
    assert.throws(() => canonicalLonLat(v), /longitude|geographic/i);
});
test("angular distance is in radians across seam, poles, and antipodes", () => {
  assert.ok(
    Math.abs(angularDistance([179, 0], [-179, 0]) - (2 * Math.PI) / 180) <
      1e-12,
  );
  assert.ok(Math.abs(angularDistance([0, 0], [90, 0]) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(angularDistance([0, 0], [180, 0]) - Math.PI) < 1e-12);
  assert.equal(angularDistance([0, 90], [99, 90]), 0);
});
test("six face centers and deterministic face tie ownership", () => {
  for (const [p, face] of [
    [[0, 0], "+X"],
    [[180, 0], "-X"],
    [[90, 0], "+Y"],
    [[-90, 0], "-Y"],
    [[0, 90], "+Z"],
    [[0, -90], "-Z"],
  ]) {
    const c = sphericalCellAddress(p, 2);
    assert.equal(c.face, face);
    assert.equal(c.i, 2);
    assert.equal(c.j, 2);
  }
  assert.equal(sphericalCellAddress([45, 0], 3).face, "+X");
  assert.equal(sphericalCellAddress([45.00001, 0], 3).face, "+Y");
  assert.deepEqual(
    sphericalCellAddress([180, 10], 5),
    sphericalCellAddress([-180, 10], 5),
  );
  assert.deepEqual(
    sphericalCellAddress([90, 90], 5),
    sphericalCellAddress([-90, 90], 5),
  );
  for (const l of [-1, 26, 0.1, NaN])
    assert.throws(() => sphericalCellAddress([0, 0], l));
});
test("exact cardinal vectors and center cells at all supported depths", () => {
  const cases = [
    [[0, 0], [1, 0, 0], "+X"],
    [[180, 0], [-1, 0, 0], "-X"],
    [[-180, 0], [-1, 0, 0], "-X"],
    [[90, 0], [0, 1, 0], "+Y"],
    [[-90, 0], [0, -1, 0], "-Y"],
    [[0, 90], [0, 0, 1], "+Z"],
    [[0, -90], [0, 0, -1], "-Z"],
  ];
  for (const [p, vector, face] of cases) {
    assert.deepEqual(lonLatVector(p), vector);
    for (let level = 0; level <= 25; level++) {
      const c = sphericalCellAddress(p, level);
      assert.equal(c.face, face);
      assert.equal(c.i, Math.floor(2 ** level / 2));
      assert.equal(c.j, Math.floor(2 ** level / 2));
    }
  }
});
test("cardinal meridians stay exact away from equator without snapping neighbors", () => {
  for (const lat of [-60, -10, 10, 60]) {
    for (const lon of [-180, -90, 0, 90, 180]) {
      const v = lonLatVector([lon, lat]);
      assert.equal(v[Math.abs(lon) === 90 ? 0 : 1], 0);
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-14);
    }
  }
  const delta = 1e-6;
  for (const lon of [-90, 0, 90]) {
    const index = lon === 0 ? 1 : 0;
    const a = lonLatVector([lon - delta, 10])[index];
    const b = lonLatVector([lon + delta, 10])[index];
    assert.ok(a * b < 0);
  }
  assert.ok(lonLatVector([180 - delta, 10])[1] > 0);
  assert.ok(lonLatVector([-180 + delta, 10])[1] < 0);
  assert.equal(sphericalCellAddress([-180 + delta, 0], 25).i, 2 ** 24 - 1);
  assert.equal(sphericalCellAddress([180 - delta, 0], 25).i, 2 ** 24);
});
test("cell ancestry at every depth and valid cube indices", () => {
  for (const p of [
    [-180, 0],
    [45, 45],
    [0, 90],
    [13, -61],
    [-123, 44],
    [89, 1],
  ]) {
    for (let l = 1; l <= 25; l++) {
      const a = sphericalCellAddress(p, l),
        b = sphericalCellAddress(p, l - 1);
      assert.equal(a.face, b.face);
      assert.equal(Math.floor(a.i / 2), b.i);
      assert.equal(Math.floor(a.j / 2), b.j);
      assert.ok(a.i >= 0 && a.i < 2 ** l && a.j >= 0 && a.j < 2 ** l);
    }
  }
});
test("deterministic occupancy and critical precedence independent of input order", () => {
  const vs = [
    vertex(0, 0, 0),
    vertex(1, 1, 0, true),
    vertex(2, 2, 0),
    vertex(3, 90, 0),
  ];
  const a = buildSphericalPriorities(vs, 20);
  assert.deepEqual(a, buildSphericalPriorities([...vs].reverse(), 20));
  assert.equal(a.levelByVertexId[1], 0);
  assert.equal(a.levelByVertexId[3], 0);
  assert.ok(a.levelByVertexId[0] > 0);
  assert.equal(new Set(a.cells.map((c) => c.key)).size, vs.length);
});
test("capacity, duplicate aliases, duplicate IDs and bad levels fail explicitly", () => {
  assert.throws(
    () => buildSphericalPriorities([vertex(0, 0, 0), vertex(1, 1, 0)], 1),
    /capacity/i,
  );
  assert.throws(
    () => buildSphericalPriorities([vertex(0, 180, 0), vertex(1, -180, 0)]),
    /distinct/i,
  );
  assert.throws(
    () => buildSphericalPriorities([vertex(0, 0, 0), vertex(0, 90, 0)]),
    /IDs/i,
  );
  assert.throws(() => buildSphericalPriorities([vertex(2, 0, 0)]), /IDs/i);
  for (const n of [0, 27, NaN, 1.5])
    assert.throws(() => buildSphericalPriorities([], n));
});
test("seeded globally distributed occupancy accounts for every vertex", () => {
  let state = 137;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const vs = Array.from({ length: 1500 }, (_, i) =>
    vertex(
      i,
      random() * 360 - 180,
      (Math.asin(random() * 2 - 1) * 180) / Math.PI,
      i % 13 === 0,
    ),
  );
  const a = buildSphericalPriorities(vs);
  assert.equal(a.cells.length, vs.length);
  assert.equal(new Set(a.cells.map((c) => c.key)).size, vs.length);
  assert.equal(new Set(a.cells.map((c) => c.vertexId)).size, vs.length);
  for (const c of a.cells) assert.equal(a.levelByVertexId[c.vertexId], c.level);
  assert.deepEqual(a, buildSphericalPriorities(vs));
});
test("great-circle paths reject ambiguous antipodal and zero-length edges", () => {
  assert.equal(
    validGreatCirclePath([
      [0, 0],
      [180, 0],
    ]),
    false,
  );
  assert.equal(
    validGreatCirclePath([
      [180, 0],
      [-180, 0],
    ]),
    false,
  );
  assert.equal(
    validGreatCirclePath([
      [30, 90],
      [40, 90],
    ]),
    false,
  );
  assert.equal(
    validGreatCirclePath([
      [179, 10],
      [-179, 10],
    ]),
    true,
  );
  assert.equal(
    validGreatCirclePath([
      [0, 0],
      [90, 0],
      [180, 0],
    ]),
    true,
  );
});
test("dateline and polar rings preserve D3 small-interior winding and complements", () => {
  for (const ring of [dateline, pole, shell]) {
    const signature = sphericalPolygonSignature([ring]);
    assert.deepEqual(signature.signs, [-1]);
    assert.deepEqual(
      sphericalPolygonSignature([[...ring].reverse()]).signs,
      [1],
    );
    assert.equal(
      validSphericalPolygon([[...ring].reverse()], signature),
      false,
    );
    assert.equal(validSphericalPolygon([ring], signature), true);
  }
});
test("spherical holes must be contained, oppositely oriented and disjoint", () => {
  assert.equal(validSphericalPolygon([shell, hole]), true);
  assert.equal(validSphericalPolygon([shell, [...hole].reverse()]), false);
  const outside = hole.map(([x, y]) => [x + 35, y]);
  assert.equal(validSphericalPolygon([shell, outside]), false);
  assert.equal(
    validSphericalPolygon([shell, hole, hole.map(([x, y]) => [x + 1, y])]),
    false,
  );
  assert.equal(validSphericalPolygon([[...shell].reverse(), hole]), false);
});
test("invalid crossing, repeated vertex, adjacent overlap and ambiguous hemisphere are rejected", () => {
  for (const ring of [
    [
      [-10, -10],
      [10, 10],
      [-10, 10],
      [10, -10],
      [-10, -10],
    ],
    [
      [0, 0],
      [0, 10],
      [0, 5],
      [10, 5],
      [0, 0],
    ],
    [
      [0, 0],
      [90, 0],
      [180, 0],
      [-90, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 10],
      [0, 10],
      [10, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [10, 0],
      [0, 10],
    ],
  ])
    assert.equal(validSphericalPolygon([ring]), false);
});
test("spherical full detail preserves source ring direction, ID and metadata", () => {
  const input = fc(
    feature(polygon(dateline), 7, { name: "seam" }),
    feature(polygon(pole), "north", null),
  );
  const snapshot = structuredClone(input);
  const d = buildSphericalQuadstream(input);
  assert.equal(d.coordinateMode, "spherical-d3");
  const q = d.query();
  assert.equal(q.usedFallback, false);
  assert.equal(q.geojson.features[0].id, 7);
  assert.deepEqual(q.geojson.features[0].properties, { name: "seam" });
  assert.equal(q.geojson.features[1].properties, null);
  for (let i = 0; i < 2; i++)
    assert.equal(
      ringKey(q.geojson.features[i].geometry.coordinates[0]),
      ringKey(input.features[i].geometry.coordinates[0]),
    );
  assert.deepEqual(input, snapshot);
});
test("seam aliases intern one shared vertex and reverse-directed shared arcs", () => {
  const d = buildSphericalQuadstream(
    fc(
      feature(line([170, 0], [180, 0], [-170, 0]), "east"),
      feature(line([-170, 0], [-180, 0], [170, 0]), "west"),
    ),
  );
  assert.equal(d.topology.vertices.length, 3);
  assert.equal(d.topology.arcs.length, 1);
  assert.equal(
    d.topology.features[0].paths[0].arcs[0],
    -d.topology.features[1].paths[0].arcs[0],
  );
  for (let l = 0; l < d.priorities.maxLevel; l++) {
    const [a, b] = d.query({ level: l }).geojson.features;
    assert.deepEqual(
      a.geometry.coordinates,
      [...b.geometry.coordinates].reverse(),
    );
  }
});
test("shared polygon boundaries remain identical at every level and BLG selections nest", () => {
  const east = [
    [0, 0],
    [0, 5],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ];
  const west = [
    [-10, 0],
    [-10, 10],
    [0, 10],
    [0, 5],
    [0, 0],
    [-10, 0],
  ];
  const d = buildSphericalQuadstream(
    fc(feature(polygon(east), "east"), feature(polygon(west), "west")),
  );
  const trees = d.arcTrees;
  for (const tree of trees) {
    assertBlgInvariants(tree);
    let previous = [];
    for (let l = 0; l < d.priorities.maxLevel; l++) {
      const p = selectBlgPositions(tree, l);
      assert.ok(previous.every((x) => p.includes(x)));
      previous = p;
    }
  }
  const refs = d.topology.features.map((f) => f.paths[0].arcs);
  assert.ok(refs[0].some((x) => refs[1].includes(-x)));
  const border = (r) =>
    r
      .filter((p) => p[0] === 0)
      .map(JSON.stringify)
      .filter((p, i, a) => a.indexOf(p) === i)
      .sort();
  for (let l = 0; l < d.priorities.maxLevel; l++) {
    const [a, b] = d.query({ level: l }).geojson.features;
    assert.deepEqual(
      border(a.geometry.coordinates[0]),
      border(b.geometry.coordinates[0]),
    );
    assert.ok(validSphericalPolygon(a.geometry.coordinates));
    assert.ok(validSphericalPolygon(b.geometry.coordinates));
  }
});
test("global fallback when coarse line introduces antipodal edge", () => {
  const d = buildSphericalQuadstream(
    fc(
      feature(line([0, 0], [90, 0], [180, 0]), "long"),
      feature(line([90, -10], [90, 10]), "critical"),
    ),
  );
  assert.equal(d.query({ level: 0 }).usedFallback, true);
  assert.deepEqual(
    d.query({ level: 0 }).geojson.features[0].geometry.coordinates,
    [
      [0, 0],
      [90, 0],
      [-180, 0],
    ],
  );
  assert.equal(d.query().usedFallback, false);
});
test("multipolygon and multiline retain structure and validate every level", () => {
  const d = buildSphericalQuadstream(
    fc(
      feature(
        { type: "MultiPolygon", coordinates: [[shell, hole], [dateline]] },
        "p",
      ),
      feature(
        {
          type: "MultiLineString",
          coordinates: [
            [
              [1, 2],
              [3, 4],
            ],
            [
              [179, 0],
              [-179, 0],
            ],
          ],
        },
        "l",
      ),
    ),
  );
  for (let l = 0; l < d.priorities.maxLevel; l++) {
    const [p, m] = d.query({ level: l }).geojson.features;
    assert.equal(p.geometry.coordinates.length, 2);
    assert.equal(p.geometry.coordinates[0].length, 2);
    assert.ok(p.geometry.coordinates.every((r) => validSphericalPolygon(r)));
    assert.ok(m.geometry.coordinates.every(validGreatCirclePath));
  }
});
test("unsupported bounds and disabled validation fail closed", () => {
  const d = buildSphericalQuadstream(fc(feature(polygon(shell))));
  for (const opts of [
    { bounds: [0, 0, 1, 1] },
    { validate: false },
    { level: -1 },
    { level: 20 },
    { level: 0.5 },
  ])
    assert.throws(() => d.query(opts));
  assert.throws(() =>
    buildSphericalQuadstream(fc(feature(line([0, 0], [180, 0])))),
  );
});
test("named transformed TopoJSON object, signed arcs, metadata and seam canonicalization", () => {
  const topo = {
    type: "Topology",
    transform: { scale: [1, 1], translate: [-180, 0] },
    arcs: [
      [
        [350, 0],
        [10, 0],
      ],
      [
        [0, 0],
        [10, 0],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "LineString", arcs: [0, 1], id: 5, properties: { x: 1 } },
          { type: "LineString", arcs: [-2, -1], id: 6 },
        ],
      },
      ignored: { type: "Point", coordinates: [0, 0] },
    },
  };
  const input = importSphericalTopoJSON(topo, "countries");
  assert.deepEqual(input.features[0].geometry.coordinates, [
    [170, 0],
    [-180, 0],
    [-170, 0],
  ]);
  assert.deepEqual(input.features[1].geometry.coordinates, [
    [-170, 0],
    [-180, 0],
    [170, 0],
  ]);
  assert.equal(input.features[0].id, 5);
  assert.deepEqual(input.features[0].properties, { x: 1 });
  assert.equal(buildSphericalQuadstream(input).topology.arcs.length, 1);
  assert.throws(() => importSphericalTopoJSON(topo, "missing"), /unknown/i);
  assert.throws(() => importSphericalTopoJSON(topo, "ignored"), /unsupported/i);
});
test("planar defaults, unrestricted coordinates and v1 partition roundtrip unchanged", () => {
  const input = fc(feature(line([1000, 1000], [1100, 1050], [1200, 1000])));
  const d = buildQuadstream(input);
  const { manifest, partitions } = exportPartitions(d);
  assert.equal(manifest.version, 1);
  const session = new QuadstreamSession(manifest);
  for (const [key, bytes] of partitions) session.load(key, bytes);
  assert.deepEqual(
    session.query({ level: manifest.maxLevel - 1 }).geojson,
    d.query().geojson,
  );
  assert.throws(() => buildSphericalQuadstream(input));
  const t = {
    type: "Topology",
    arcs: [
      [
        [1000, 1000],
        [1200, 1000],
      ],
    ],
    objects: { a: { type: "LineString", arcs: [0] } },
  };
  assert.equal(importTopoJSON(t).features.length, 1);
});
