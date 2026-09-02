import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OceanDatabase } from "../db/database.js";
import { RagStore } from "./rag-store.js";
import type { RagDocument } from "./types.js";

function document(
  id: string,
  title: string,
  cardType: RagDocument["cardType"] = "dataset",
  primary?: string,
): RagDocument {
  return {
    id,
    cardType,
    title,
    content: `${title} authoritative ocean dataset`,
    sourceIds: [id],
    payload: primary
      ? { title, research_field: { primary, secondary: [] } }
      : { title },
    sourcePath: `${id}.json`,
    sourceHash: `${id}-hash`,
  };
}

describe("RagStore hybrid retrieval", () => {
  let database: OceanDatabase;
  let store: RagStore;

  beforeEach(() => {
    database = new OceanDatabase(":memory:");
    store = new RagStore(database);
    store.upsert(document("oisst", "NOAA Daily OISST"), [1, 0, 0], "embedding-test", 3);
    store.upsert(document("era5", "ERA5 Reanalysis"), [0, 1, 0], "embedding-test", 3);
    store.upsert(document("olci", "Sentinel-3 OLCI"), [0, 0, 1], "embedding-test", 3);
  });

  afterEach(() => database.close());

  it("returns only semantically confident documents", () => {
    const results = store.search("daily sea surface temperature OISST", [0.99, 0.1, 0], "embedding-test", 3, {
      cardType: "dataset",
      limit: 8,
    });
    expect(results.map((item) => item.id)).toEqual(["oisst"]);
    expect(results[0]?.score).toBeGreaterThan(0.9);
  });

  it("rejects retrieval when the best semantic match is weak", () => {
    const results = store.search("unrepresented topic", [0.3, 0.3, 0.3], "embedding-test", 3, {
      cardType: "dataset",
      limit: 8,
    });
    expect(results).toEqual([]);
  });

  it("isolates card types and filters research cases by controlled field", () => {
    store.upsert(document("tc", "Tropical cyclone forecast", "problem_solution", "D0612"), [1, 0, 0], "embedding-test", 3);
    store.upsert(document("coral", "Coral ecology", "problem_solution", "D0604"), [0.9, 0.1, 0], "embedding-test", 3);
    const results = store.search("ocean research", [1, 0, 0], "embedding-test", 3, {
      cardType: "problem_solution",
      researchFields: ["D0604"],
      limit: 8,
    });
    expect(results.map((item) => item.id)).toEqual(["coral"]);
  });

  it("stores usage bundles for exact lookup without semantic search", () => {
    const bundle = document("bundle", "Experiment DAG", "usage_bundle");
    store.upsert(bundle, null);
    expect(store.getDocument("bundle", "usage_bundle")?.id).toBe("bundle");
    expect(store.countByType("usage_bundle")).toBe(1);
  });

  it("detects changed embedding metadata", () => {
    const same = document("oisst", "NOAA Daily OISST");
    expect(store.needsEmbedding(same, "embedding-test", 3)).toBe(false);
    expect(store.needsEmbedding(same, "another-model", 3)).toBe(true);
  });
});
