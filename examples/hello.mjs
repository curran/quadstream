import {
  buildQuadstream,
  exportPartitions,
  QuadstreamSession,
} from "../dist/index.js";

const input = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "west",
      properties: { value: 10 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "east",
      properties: { value: 20 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10, 0],
            [20, 0],
            [20, 10],
            [10, 10],
            [10, 0],
          ],
        ],
      },
    },
  ],
};
const dataset = buildQuadstream(input, { maxLevel: 12 });
const { manifest, partitions } = exportPartitions(dataset, { fileDepth: 3 });
const session = new QuadstreamSession(manifest);
for (const [key, bytes] of partitions) session.load(key, bytes);
const result = session.query({ level: 11, bounds: [0, 0, 20, 10] });
if (!result.complete || result.geojson.features.length !== 2)
  throw new Error("Progressive reconstruction failed");
console.log(
  JSON.stringify(
    {
      features: result.geojson.features.length,
      vertices: manifest.vertices.length,
      arcs: manifest.arcs.length,
      partitions: partitions.size,
      complete: result.complete,
    },
    null,
    2,
  ),
);
