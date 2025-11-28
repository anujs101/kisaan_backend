// test/geospatial.test.ts
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import {
  distanceBetweenPointsMeters,
  distanceToImageMeters,
  isWithinDistanceOfImage,
  isPointInPolygon,
  verifyDistanceToImage,
} from "../src/utils/geospatial.js";
import { setupTestDB, teardownTestDB } from "./setup-test-db.js";

let fixtures: Awaited<ReturnType<typeof setupTestDB>>;

describe("geospatial helpers (integration)", () => {
  beforeAll(async () => {
    fixtures = await setupTestDB();
  });

  afterAll(async () => {
    if (fixtures) {
      await teardownTestDB(fixtures);
    }
  });

  it("distanceBetweenPointsMeters: should return a small distance between nearby points", async () => {
    // create a point ~10 meters away by small offset (~0.00009 deg)
    const latA = fixtures.lat;
    const lonA = fixtures.lon;
    const latB = fixtures.lat + 0.00009;
    const lonB = fixtures.lon + 0.00009;

    const d = await distanceBetweenPointsMeters(latA, lonA, latB, lonB);
    expect(typeof d).toBe("number");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(200); // should be < 200m for such small delta
  });

  it("distanceToImageMeters: should compute distance from test point to image geom", async () => {
    const dist = await distanceToImageMeters(fixtures.imageId, fixtures.lat, fixtures.lon);
    expect(typeof dist).toBe("number");
    expect(dist).toBeGreaterThanOrEqual(0);
    // same point -> distance approximately 0
    expect(dist).toBeLessThan(1);
  });

  it("isWithinDistanceOfImage: returns true for threshold >= 10m", async () => {
    const isWithin = await isWithinDistanceOfImage(fixtures.imageId, fixtures.lat, fixtures.lon, 10);
    expect(isWithin).toBe(true);
  });

  it("isPointInPolygon: returns true for point inside polygon", async () => {
    const contains = await isPointInPolygon("farm_polygons", fixtures.polygonId, fixtures.lat, fixtures.lon);
    expect(contains).toBe(true);
  });

  it("verifyDistanceToImage: returns withinThreshold true for default threshold", async () => {
    const res = await verifyDistanceToImage(fixtures.imageId, fixtures.lat, fixtures.lon);
    expect(res.withinThreshold).toBe(true);
    expect(typeof res.distanceMeters === "number").toBe(true);
  });
});
