import { describe, expect, it } from "vitest";
import { nawcSkills } from "../src/index.ts";

describe("NAWC skills plugin", () => {
  it("contains the attached workflow skills", () => {
    expect(nawcSkills().skills?.map((skill) => skill.name)).toEqual([
      "nawc",
      "orient",
      "refine",
      "split",
      "probe",
      "ticket-ready",
      "implement",
      "review-implementation",
    ]);
  });

  it("does not contribute a browser client", () => {
    expect(nawcSkills()).not.toHaveProperty("client");
  });
});
