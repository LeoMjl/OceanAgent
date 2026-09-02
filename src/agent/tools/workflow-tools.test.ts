import { describe, expect, it } from "vitest";
import { normalizePlanSteps } from "./workflow-tools.js";

describe("normalizePlanSteps", () => {
  const step = { id: "S1", title: "准备数据", description: "下载并质控数据" };

  it("keeps a structured step array", () => {
    expect(normalizePlanSteps([step])).toEqual([step]);
  });

  it("recovers a JSON step array accidentally serialized with trailing fields", () => {
    const serialized = `${JSON.stringify([step])}, \"datasets\"> [\"OISST\"]`;
    expect(normalizePlanSteps(serialized)).toEqual([step]);
  });

  it("rejects malformed step objects", () => {
    expect(() => normalizePlanSteps([{ id: "S1" }])).toThrow("缺少id、title或description");
  });
});
