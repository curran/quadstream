import test from "node:test";
import assert from "node:assert/strict";
import {
  importGeoJSON,
  exportGeoJSON,
  importTopoJSON,
  exportTopoJSON,
  buildQuadstream,
  exportPartitions,
  QuadstreamSession,
  validateManifest,
} from "../dist/index.js";

const feature = (type, coordinates, id, properties = { value: 42 }) => ({
  type: "Feature",
  id,
  properties,
  geometry: { type, coordinates },
});
const fc = (...features) => ({ type: "FeatureCollection", features });
const line = feature(
  "LineString",
  [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  7,
  null,
);
const outer = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
  [0, 0],
];
const hole = [
  [1, 1],
  [1, 2],
  [2, 2],
  [2, 1],
  [1, 1],
];
const square = [
  [8, 0],
  [9, 0],
  [9, 1],
  [8, 1],
  [8, 0],
];
const cases = [
  line,
  feature(
    "MultiLineString",
    [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 3],
      ],
    ],
    "multi-line",
  ),
  feature("Polygon", [outer, hole], "polygon"),
  feature("MultiPolygon", [[outer, hole], [square]], "multi-polygon"),
];
const canonicalRing = (r) => {
  const p = r.slice(0, -1);
  const variants = p.map((_, i) =>
    JSON.stringify([...p.slice(i), ...p.slice(0, i)]),
  );
  return variants.sort()[0];
};
function canonical(g) {
  switch (g.type) {
    case "Polygon":
      return [g.type, g.coordinates.map(canonicalRing)];
    case "MultiPolygon":
      return [g.type, g.coordinates.map((p) => p.map(canonicalRing))];
    default:
      return [g.type, g.coordinates];
  }
}
function compare(actual, expected) {
  assert.equal(actual.features.length, expected.features.length);
  actual.features.forEach((f, i) => {
    const e = expected.features[i];
    assert.equal(f.id, e.id);
    assert.deepEqual(f.properties, e.properties);
    assert.deepEqual(canonical(f.geometry), canonical(e.geometry));
  });
}
for (const f of cases)
  test("GeoJSON and TopoJSON round trip: " + f.geometry.type, () => {
    const input = fc(f),
      snapshot = structuredClone(input);
    assert.deepEqual(importGeoJSON(input), input);
    assert.deepEqual(exportGeoJSON(input), input);
    compare(
      importTopoJSON(JSON.parse(JSON.stringify(exportTopoJSON(input)))),
      input,
    );
    assert.deepEqual(input, snapshot);
  });
test("GeoJSON single Feature import and empty output", () => {
  assert.deepEqual(importGeoJSON(line), fc(line));
  assert.deepEqual(exportGeoJSON(fc()), fc());
  assert.deepEqual(exportTopoJSON(fc()).arcs, []);
});
test("TopoJSON transformed delta arcs reset per arc, reverse via complement, and stitch", () => {
  const t = {
    type: "Topology",
    transform: { scale: [2, 3], translate: [10, -5] },
    arcs: [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 1],
        [-1, 0],
      ],
    ],
    objects: {
      one: { type: "LineString", id: "a", properties: { a: 1 }, arcs: [0, -2] },
      two: {
        type: "GeometryCollection",
        geometries: [{ type: "LineString", id: "b", arcs: [-1] }],
      },
    },
  };
  const result = importTopoJSON(t);
  assert.deepEqual(result.features[0].geometry.coordinates, [
    [10, -5],
    [12, -2],
    [14, -2],
  ]);
  assert.deepEqual(result.features[1].geometry.coordinates, [
    [12, -2],
    [10, -5],
  ]);
  assert.equal(result.features[1].properties, null);
});
test("unquantized arcs are absolute, never delta-accumulated", () => {
  const t = {
    type: "Topology",
    arcs: [
      [
        [3, 4],
        [5, 6],
      ],
    ],
    objects: { a: { type: "LineString", arcs: [0] } },
  };
  assert.deepEqual(importTopoJSON(t).features[0].geometry.coordinates, [
    [3, 4],
    [5, 6],
  ]);
});
test("adjacent polygons share signed arc references and reconstruct exact boundaries", () => {
  const left = feature(
    "Polygon",
    [
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
    "left",
  );
  const right = feature(
    "Polygon",
    [
      [
        [2, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 1],
        [2, 0],
      ],
    ],
    "right",
  );
  const input = fc(left, right),
    topo = exportTopoJSON(input),
    [a, b] = topo.objects.data.geometries;
  assert.ok(a.arcs[0].some((ref) => b.arcs[0].includes(-ref - 1)));
  compare(importTopoJSON(topo), input);
  assert.deepEqual(exportTopoJSON(input), topo);
});
const badGeo = [
  ["null", null],
  ["empty collection", fc()],
  ["null geometry", { ...line, geometry: null }],
  ["unsupported point", feature("Point", [1, 2], "p")],
  [
    "3D",
    feature(
      "LineString",
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
      "x",
    ),
  ],
  [
    "nonfinite",
    feature(
      "LineString",
      [
        [0, 0],
        [Infinity, 1],
      ],
      "x",
    ),
  ],
  [
    "string coordinate",
    feature(
      "LineString",
      [
        [0, 0],
        ["1", 1],
      ],
      "x",
    ),
  ],
  ["empty line", feature("LineString", [], "x")],
  [
    "degenerate line",
    feature(
      "LineString",
      [
        [1, 1],
        [1, 1],
      ],
      "x",
    ),
  ],
  ["empty polygon", feature("Polygon", [], "x")],
  [
    "unclosed ring",
    feature(
      "Polygon",
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
      "x",
    ),
  ],
  [
    "self intersection",
    feature(
      "Polygon",
      [
        [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
          [0, 0],
        ],
      ],
      "x",
    ),
  ],
  ["hole outside", feature("Polygon", [outer, square], "x")],
  ["invalid properties", { ...line, properties: [1] }],
  ["invalid id", { ...line, id: {} }],
  ["duplicate ids", fc(line, line)],
  ["CRS", { ...fc(line), crs: { type: "name" } }],
];
for (const [name, value] of badGeo)
  test("reject GeoJSON " + name, () =>
    assert.throws(() => importGeoJSON(value)),
  );
const topoInput = {
  type: "Topology",
  arcs: [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [3, 3],
      [4, 4],
    ],
  ],
  objects: { a: { type: "LineString", arcs: [0] } },
};
const badTopo = [
  ["reference outside range", (t) => (t.objects.a.arcs = [2])],
  ["negative outside range", (t) => (t.objects.a.arcs = [-3])],
  ["fractional reference", (t) => (t.objects.a.arcs = [0.5])],
  ["disconnected arcs", (t) => (t.objects.a.arcs = [0, 1])],
  ["empty arcs", (t) => (t.objects.a.arcs = [])],
  ["short arc", (t) => (t.arcs[0] = [[0, 0]])],
  ["zero scale", (t) => (t.transform = { scale: [0, 1], translate: [0, 0] })],
  ["invalid transform", (t) => (t.transform = { scale: [1, 1] })],
  [
    "fractional delta",
    (t) => {
      t.transform = { scale: [1, 1], translate: [0, 0] };
      t.arcs[0][0] = [0.5, 0];
    },
  ],
  ["unsupported geometry", (t) => (t.objects.a.type = "Point")],
  ["empty objects", (t) => (t.objects = {})],
  [
    "unclosed polygon",
    (t) => {
      t.objects.a.type = "Polygon";
      t.objects.a.arcs = [[0]];
    },
  ],
];
for (const [name, mutate] of badTopo)
  test("reject TopoJSON " + name, () => {
    const t = structuredClone(topoInput);
    mutate(t);
    assert.throws(() => importTopoJSON(t));
  });
test("seeded line round trips preserve reverse direction and metadata", () => {
  let state = 12345;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % 1000;
  };
  for (let trial = 0; trial < 40; trial++) {
    const coords = Array.from({ length: 15 }, (_, i) => [i, next()]);
    const input = fc(
      feature("LineString", coords, "a", { trial }),
      feature("LineString", [...coords].reverse(), "b", null),
    );
    const t = exportTopoJSON(input);
    compare(importTopoJSON(t), input);
    assert.deepEqual(t, exportTopoJSON(input));
  }
});
const bundle = exportPartitions(
  buildQuadstream(fc(feature("Polygon", [outer, hole], "p"))),
);
test("v1 manifest accepts generated JSON and progressive reconstruction converges", () => {
  const m = validateManifest(JSON.parse(JSON.stringify(bundle.manifest)));
  const s = new QuadstreamSession(m);
  for (const [k, v] of [...bundle.partitions].reverse()) s.load(k, v);
  const result = s.query({ level: m.maxLevel - 1 });
  assert.equal(result.complete, true);
  compare(result.geojson, fc(feature("Polygon", [outer, hole], "p")));
});
const badManifest = [
  ["version", (m) => (m.version = 2)],
  ["format", (m) => (m.format = "other")],
  ["level", (m) => (m.maxLevel = 27)],
  ["depth", (m) => (m.fileDepth = 0)],
  ["bounds", (m) => (m.bounds = [2, 0, 1, 1])],
  ["vertex ID", (m) => (m.vertices[0].id = 99)],
  ["vertex level", (m) => (m.vertices[0].level = m.maxLevel)],
  ["arc ID", (m) => (m.arcs[0].id = 99)],
  ["arc vertex", (m) => (m.arcs[0].vertexIds[0] = 99999)],
  ["zero arc ref", (m) => (m.features[0].paths[0].arcs[0] = 0)],
  ["arc ref out of range", (m) => (m.features[0].paths[0].arcs[0] = 99999)],
  ["ring closure", (m) => (m.features[0].paths[0].closed = false)],
  ["path ref", (m) => (m.features[0].groups[0][0] = 9999)],
  [
    "path accounting",
    (m) => m.features[0].groups[0].push(m.features[0].groups[0][0]),
  ],
  ["unsafe key", (m) => (m.partitions[0].key = "../escape")],
  ["duplicate key", (m) => m.partitions.push(m.partitions[0])],
  ["length", (m) => m.partitions[0].byteLength++],
  ["checksum", (m) => (m.partitions[0].checksum = "garbage")],
  ["vertex missing", (m) => (m.partitions = [])],
  ["partition level", (m) => (m.partitions[0].minLevel = 999)],
];
for (const [name, mutate] of badManifest)
  test("reject manifest " + name, () => {
    const m = structuredClone(bundle.manifest);
    mutate(m);
    assert.throws(() => validateManifest(m));
  });
