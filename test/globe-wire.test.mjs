import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { packGeometry, unpackGeometry } from "../dist/index.js";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";
import { GlobeWorkerClient } from "../examples/globe/client.mjs";

test("packGeometry / unpackGeometry round-trips mixed Polygon and MultiPolygon with holes and empty polygons", () => {
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "poly-with-hole",
        properties: { name: "Island", code: 1 },
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
            [
              [2, 2],
              [2, 5],
              [5, 5],
              [5, 2],
              [2, 2],
            ],
          ],
        },
      },
      {
        type: "Feature",
        id: 42,
        properties: { name: "Archipelago" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [-10, -10],
                [-5, -10],
                [-5, -5],
                [-10, -5],
                [-10, -10],
              ],
            ],
            [
              [
                [20, 20],
                [30, 20],
                [30, 30],
                [20, 30],
                [20, 20],
              ],
              [
                [22, 22],
                [22, 24],
                [24, 24],
                [24, 22],
                [22, 22],
              ],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { name: "EmptyPolygon" },
        geometry: {
          type: "Polygon",
          coordinates: [],
        },
      },
      {
        type: "Feature",
        id: "empty-multi",
        properties: { name: "EmptyMultiPolygon" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [],
        },
      },
    ],
  };

  const { coords, meta } = packGeometry(fc);
  assert.ok(coords instanceof Float64Array);
  assert.ok(meta instanceof Int32Array);

  const unpacked = unpackGeometry(fc, coords, meta);
  assert.deepEqual(unpacked, fc);
});

test("packGeometry / unpackGeometry round-trips world-atlas/countries-110m.json at level 5.5", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL(
        "../node_modules/world-atlas/countries-110m.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = decodeCountries(raw, topojson);
  const engine = createGlobeGeometry(original, d3);
  const frame = engine.query(5.5);

  const { coords, meta } = packGeometry(frame.geojson);
  const unpacked = unpackGeometry(original, coords, meta);
  assert.deepEqual(unpacked, frame.geojson);
});

test("GlobeWorkerClient transfers ArrayBuffers and reconstructs frame.geojson from coords and meta", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL(
        "../node_modules/world-atlas/countries-110m.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = decodeCountries(raw, topojson);
  const engine = createGlobeGeometry(original, d3);
  let expectedGeojson;
  let expectedRest;

  const listeners = new Map();
  let transferredBuffers = null;
  const mockWorker = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    postMessage(msg) {
      queueMicrotask(() => {
        if (msg.type === "init") {
          const response = {
            id: msg.id,
            original,
            sourceVertices: engine.sourceVertices,
            buildMs: engine.buildMs,
            unavailable: engine.unavailable,
            reasons: engine.reasons,
          };
          for (const fn of listeners.get("message") ?? []) {
            fn({ data: response });
          }
        } else if (msg.type === "query") {
          const frame = engine.query(msg.level);
          const { geojson, ...rest } = frame;
          expectedGeojson = geojson;
          expectedRest = rest;
          const { coords, meta } = packGeometry(geojson);
          const transfer = [coords.buffer, meta.buffer];
          transferredBuffers = transfer;
          const cloned = structuredClone(
            { id: msg.id, frame: rest, coords, meta },
            { transfer },
          );
          assert.equal(coords.buffer.byteLength, 0);
          assert.equal(meta.buffer.byteLength, 0);
          for (const fn of listeners.get("message") ?? []) {
            fn({ data: cloned });
          }
        }
      });
    },
    terminate() {},
  };

  const client = new GlobeWorkerClient(mockWorker);
  const initRes = await client.init(raw);
  assert.equal(initRes.original, original);
  assert.equal(client.original, original);

  const frame = await client.query(5.5);
  assert.equal(transferredBuffers.length, 2);
  assert.deepEqual(frame.geojson, expectedGeojson);
  assert.deepEqual(
    Object.fromEntries(Object.entries(frame).filter(([k]) => k !== "geojson")),
    { ...expectedRest, seq: 2 },
  );
  client.dispose();
});

test("malformed wire data and unsupported geometry are rejected", () => {
  const original={type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[]}}]};
  assert.throws(()=>unpackGeometry(original,new Float64Array(),new Int32Array([1,-1])));
  assert.throws(()=>unpackGeometry(original,new Float64Array([1]),new Int32Array([1,0])));
  assert.throws(()=>packGeometry({type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[]}}]}));
});
