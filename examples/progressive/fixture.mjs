// Original schematic land polygons. Not geographic boundary data.
const shapes = [
  [
    "North America",
    [
      [-160, 50],
      [-144, 66],
      [-96, 66],
      [-56, 42],
      [-80, 18],
      [-120, 18],
      [-160, 50],
    ],
  ],
  [
    "South America",
    [
      [-80, 10],
      [-48, 10],
      [-32, -14],
      [-56, -54],
      [-72, -30],
      [-80, 10],
    ],
  ],
  [
    "Europe",
    [
      [-8, 34],
      [8, 58],
      [40, 58],
      [56, 42],
      [24, 34],
      [-8, 34],
    ],
  ],
  [
    "Africa",
    [
      [-16, 30],
      [32, 30],
      [48, 6],
      [24, -34],
      [0, -34],
      [-16, 6],
      [-16, 30],
    ],
  ],
  [
    "Asia",
    [
      [56, 42],
      [40, 58],
      [96, 74],
      [168, 50],
      [144, 18],
      [112, 2],
      [80, 18],
      [56, 42],
    ],
  ],
  [
    "Australia",
    [
      [112, -10],
      [152, -10],
      [152, -34],
      [120, -34],
      [112, -10],
    ],
  ],
  [
    "Greenland",
    [
      [-64, 62],
      [-48, 78],
      [-24, 78],
      [-32, 62],
      [-64, 62],
    ],
  ],
];
// Subdivide by powers of two: exact binary arithmetic and matching shared edges.
const densify = (ring) =>
  ring.flatMap((a, i) => {
    if (i === ring.length - 1) return [a];
    const b = ring[i + 1];
    return Array.from({ length: 8 }, (_, j) => [
      a[0] + ((b[0] - a[0]) * j) / 8,
      a[1] + ((b[1] - a[1]) * j) / 8,
    ]);
  });
export const schematic = {
  type: "FeatureCollection",
  features: shapes.map(([name, ring]) => ({
    type: "Feature",
    id: name,
    properties: { name },
    geometry: { type: "Polygon", coordinates: [densify(ring).reverse()] },
  })),
};
