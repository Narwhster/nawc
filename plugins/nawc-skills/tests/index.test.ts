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
      "splash-zone",
    ]);
  });

  it("recommends the splash-zone skill from related skills", () => {
    const skills = nawcSkills().skills ?? [];
    const splashZone = skills.find((skill) => skill.name === "splash-zone");
    expect(splashZone).toBeDefined();
    const names = new Set(skills.map((skill) => skill.name));
    const recommenders = ["orient", "split", "ticket-ready", "implement", "review-implementation"];
    for (const name of recommenders) {
      const skill = skills.find((entry) => entry.name === name);
      expect(skill?.content).toContain("splash-zone");
    }
    expect(names).toContain("nawc");
  });

  it("does not contribute a browser client", () => {
    expect(nawcSkills()).not.toHaveProperty("client");
  });

  it("documents inline code blocks in the NAWC skill", () => {
    const skill = nawcSkills().skills?.find((entry) => entry.name === "nawc");
    expect(skill?.content).toContain('<code file="path/to/file" />');
    expect(skill?.content).toContain('<code syntax="typescript">');
    expect(skill?.content).toContain('<runnable syntax="typescript">');
    expect(skill?.content).toContain("short executable source");
    expect(skill?.content).toContain("Do not copy file-backed source into those elements");
  });
});
