import { describe, expect, it } from "vitest";
import { ACTIVE_TOOL_NAMES, OCEAN_TOOL_NAMES, PI_CORE_TOOL_NAMES } from "./index.js";

describe("OceanAgent tool whitelist", () => {
  it("activates the four Pi core tools alongside all ocean tools", () => {
    expect(PI_CORE_TOOL_NAMES).toEqual(["read", "bash", "edit", "write"]);
    expect(OCEAN_TOOL_NAMES).toContain("run_remote_command");
    expect(OCEAN_TOOL_NAMES).toContain("report_research_reasoning");
    expect(OCEAN_TOOL_NAMES).toEqual(expect.arrayContaining([
      "search_research_cases",
      "expand_research_case",
      "search_ocean_datasets",
      "get_dataset_facts",
    ]));
    expect(OCEAN_TOOL_NAMES).not.toContain("search_ocean_knowledge");
    expect(ACTIVE_TOOL_NAMES).toEqual([...PI_CORE_TOOL_NAMES, ...OCEAN_TOOL_NAMES]);
    expect(new Set(ACTIVE_TOOL_NAMES).size).toBe(ACTIVE_TOOL_NAMES.length);
  });
});
