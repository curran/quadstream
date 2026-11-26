// Original schematic rings; deterministic offline test data, not a world atlas.
const densify = (ring) =>
  ring.flatMap((a, i) =>
    i === ring.length - 1
      ? [a]
      : Array.from({ length: 8 }, (_, j) => {
          const b = ring[i + 1];
          return [
            a[0] + ((b[0] - a[0]) * j) / 8,
            a[1] + ((b[1] - a[1]) * j) / 8,
          ];
        }),
  );
const shapes = [
  [
    "east",
    [
      [0, -20],
      [0, 20],
      [40, 20],
      [40, -20],
      [0, -20],
    ],
  ],
  [
    "west",
    [
      [-40, -20],
      [-40, 20],
      [0, 20],
      [0, -20],
      [-40, -20],
    ],
  ],
  [
    "seam",
    [
      [170, -10],
      [170, 10],
      [-170, 10],
      [-170, -10],
      [170, -10],
    ],
  ],
  [
    "north",
    [
      [135, 80],
      [45, 80],
      [-45, 80],
      [-135, 80],
      [135, 80],
    ],
  ],
];
export const fixture = {
  type: "FeatureCollection",
  features: shapes.map(([id, ring], i) => ({
    type: "Feature",
    id,
    properties: { name: id },
    geometry: { type: "Polygon", coordinates: [i < 2 ? densify(ring) : ring] },
  })),
};
