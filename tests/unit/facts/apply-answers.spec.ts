import { applyAnswers } from "../../../src/facts/apply-answers";
import type { Answer } from "../../../src/facts/schema";
import { sampleFacts } from "../../helpers/facts-fixture";

let counter = 0;
function answer(partial: Partial<Answer> & Pick<Answer, "factId" | "action">): Answer {
  counter += 1;
  return {
    id: `ans_${counter}`,
    by: "dev@example.com",
    at: `2026-10-10T00:00:${String(counter).padStart(2, "0")}.000Z`,
    source: "review",
    ...partial,
  };
}

describe("applyAnswers", () => {
  const { facts, files } = sampleFacts();

  it("returns the scan unchanged when there are no answers, and does not change its inputs", () => {
    const before = JSON.stringify({ facts, files });
    const state = applyAnswers(facts, files, []);
    expect(state.facts).toEqual(facts);
    expect(state.dataItemFiles).toEqual(files);
    expect(JSON.stringify({ facts, files })).toBe(before);
    expect(state.facts).not.toBe(facts);
  });

  describe("set", () => {
    it("overrides one property of a component and leaves the rest", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "cmp_mail", action: "set", property: "name", value: "SendGrid Inc" })]);
      const mail = state.facts.components.find((c) => c.id === "cmp_mail");
      expect(mail).toMatchObject({ name: "SendGrid Inc", type: "third_party", subType: "email" });
      expect(state.applied).toHaveLength(1);
    });

    it("lets the latest answer for a property win, by time and not by position in the file", () => {
      const late = answer({ factId: "flow_mail", action: "set", property: "purpose", value: "marketing", at: "2026-11-01T00:00:00.000Z" });
      const early = answer({ factId: "flow_mail", action: "set", property: "purpose", value: "security", at: "2026-10-01T00:00:00.000Z" });
      const state = applyAnswers(facts, files, [late, early]);
      expect((state.facts.dataFlows.find((f) => f.id === "flow_mail") as Record<string, unknown>).purpose).toBe("marketing");
    });

    it("adds a property the scan did not have", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "cmp_user", action: "set", property: "actor_kind", value: "persona" })]);
      expect((state.facts.components.find((c) => c.id === "cmp_user") as Record<string, unknown>).actor_kind).toBe("persona");
    });

    it("sets a data item in facts.json and in its file, and a group in both", () => {
      const state = applyAnswers(facts, files, [
        answer({ factId: "data_item:email", action: "set", property: "labels", value: ["contact", "pii"] }),
        answer({ factId: "group:email:staff", action: "set", property: "label", value: "employees" }),
      ]);
      expect(state.facts.dataItems[0].labels).toEqual(["contact", "pii"]);
      expect(state.dataItemFiles[0].labels).toEqual(["contact", "pii"]);
      expect(state.facts.dataItems[0].groups.find((g) => g.id === "group:email:staff")?.label).toBe("employees");
      expect(state.dataItemFiles[0].groups.find((g) => g.id === "group:email:staff")?.label).toBe("employees");
    });

    it("sets a property of an occurrence", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "occurrence:email:src/a.ts:3", action: "set", property: "labels", value: ["verified"] })]);
      expect(state.dataItemFiles[0].occurrences[0].labels).toEqual(["verified"]);
    });

    it("keeps answers about the system apart from Facts", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "dp:a0/system", action: "set", property: "in_scope", value: "The web app" })]);
      expect(state.system).toEqual({ in_scope: "The web app" });
      expect(state.facts).toEqual(facts);
    });

    it.each(["id", "file", "codeRefs", "groups", "occurrences"])("refuses to change %s", (property) => {
      const a = answer({ factId: "cmp_api", action: "set", property, value: "x" });
      const state = applyAnswers(facts, files, [a]);
      expect(state.ignored).toEqual([a]);
      expect(state.facts).toEqual(facts);
    });

    it("ignores a set without a property", () => {
      const a = answer({ factId: "cmp_api", action: "set", value: "x" });
      expect(applyAnswers(facts, files, [a]).ignored).toEqual([a]);
    });
  });

  describe("remove", () => {
    it("drops a flow and the relations that mention it", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "flow_mail", action: "remove" })]);
      expect(state.facts.dataFlows.map((f) => f.id)).toEqual(["flow_login"]);
      expect(state.facts.relations.map((r) => r.type)).toEqual(["handled_by"]);
    });

    it("drops a component with its flows and every handledBy reference to it", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "cmp_mail", action: "remove" })]);
      expect(state.facts.components.map((c) => c.id)).toEqual(["cmp_api", "cmp_user"]);
      expect(state.facts.dataFlows.map((f) => f.id)).toEqual(["flow_login"]);
      const staff = state.facts.dataItems[0].groups.find((g) => g.id === "group:email:staff");
      expect(staff?.handledBy).toEqual(["cmp_api"]);
      expect(state.dataItemFiles[0].groups.find((g) => g.id === "group:email:staff")?.handledBy).toEqual(["cmp_api"]);
      expect(state.facts.relations).toEqual([]);
    });

    it("drops a data item with its occurrences, its file and its entry in facts.json", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "data_item:email", action: "remove" })]);
      expect(state.facts.dataItems.map((i) => i.id)).toEqual(["data_item:phone"]);
      expect(state.dataItemFiles.map((f) => f.id)).toEqual(["data_item:phone"]);
      expect(state.facts.relations.some((r) => r.source.startsWith("group:email"))).toBe(false);
    });

    it("drops a group with its occurrences and fixes the counts", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "group:email:customer", action: "remove" })]);
      expect(state.dataItemFiles[0].occurrences.map((o) => o.id)).toEqual(["occurrence:email:src/c.ts:1"]);
      expect(state.facts.dataItems[0].occurrenceCount).toBe(1);
      expect(state.facts.dataItems[0].groups.map((g) => g.id)).toEqual(["group:email:staff"]);
    });

    it("drops one occurrence and fixes the counts", () => {
      const state = applyAnswers(facts, files, [answer({ factId: "occurrence:email:src/a.ts:3", action: "remove" })]);
      expect(state.dataItemFiles[0].occurrences).toHaveLength(2);
      expect(state.facts.dataItems[0].occurrenceCount).toBe(2);
      expect(state.facts.dataItems[0].groups.find((g) => g.id === "group:email:customer")?.occurrenceCount).toBe(1);
      expect(state.dataItemFiles[0].groups.find((g) => g.id === "group:email:customer")?.occurrenceCount).toBe(1);
    });

    it("is final: a later set about a removed Fact is ignored, also through its parent", () => {
      const state = applyAnswers(facts, files, [
        answer({ factId: "data_item:phone", action: "remove" }),
        answer({ factId: "data_item:phone", action: "set", property: "labels", value: ["x"] }),
        answer({ factId: "occurrence:phone:src/a.ts:7", action: "set", property: "labels", value: ["x"] }),
      ]);
      expect(state.ignored).toHaveLength(2);
      expect(state.applied).toHaveLength(1);
    });

    it("cannot remove the system", () => {
      const a = answer({ factId: "dp:a0/system", action: "remove" });
      expect(applyAnswers(facts, files, [a]).ignored).toEqual([a]);
    });
  });

  it("returns an answer about a Fact the scan does not have as an orphan, and applies the rest", () => {
    const gone = answer({ factId: "flow_old", action: "set", property: "purpose", value: "security" });
    const kept = answer({ factId: "cmp_api", action: "set", property: "name", value: "API" });
    const state = applyAnswers(facts, files, [gone, kept]);
    expect(state.orphans).toEqual([gone]);
    expect(state.applied).toEqual([kept]);
  });
});
