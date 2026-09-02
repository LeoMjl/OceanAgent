import { describe, expect, it } from "vitest";
import { firstQuestionTitle } from "./project-routes.js";

describe("firstQuestionTitle", () => {
  it("uses the normalized first 20 characters", () => {
    expect(firstQuestionTitle("  评估西北太平洋热带气旋路径预报所需的数据与方法  "))
      .toBe("评估西北太平洋热带气旋路径预报所需的数据");
  });

  it("collapses whitespace before truncating", () => {
    expect(firstQuestionTitle("海洋   环流\n研究")).toBe("海洋 环流 研究");
  });
});
