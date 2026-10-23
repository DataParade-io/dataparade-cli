import { dataItemFilePath, dataItemSlugs } from "../../../src/facts/slug";

describe("dataItemSlugs", () => {
  it("makes plain, file-safe slugs", () => {
    const slugs = dataItemSlugs(["email", "Credit Card", "a/b\\c:d", "ünïcode", "  ", "../etc/passwd"]);
    expect(slugs.get("email")).toBe("email");
    expect(slugs.get("Credit Card")).toBe("credit-card");
    expect(slugs.get("a/b\\c:d")).toBe("a-b-c-d");
    expect(slugs.get("ünïcode")).toBe("unicode");
    expect(slugs.get("  ")).toBe("item");
    expect(slugs.get("../etc/passwd")).toBe("etc-passwd");
    for (const slug of slugs.values()) expect(slug).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
  });

  it("gives clashing names a hash of their own name, whatever the order", () => {
    const one = dataItemSlugs(["Email", "email"]);
    const two = dataItemSlugs(["email", "Email"]);
    expect(one.get("Email")).toBe(two.get("Email"));
    expect(one.get("email")).toBe(two.get("email"));
    expect(one.get("Email")).not.toBe(one.get("email"));
    expect(one.get("email")).toMatch(/^email-[0-9a-f]{6}$/);
  });

  it("keeps long names short", () => {
    expect((dataItemSlugs(["x".repeat(500)]).get("x".repeat(500)) ?? "").length).toBeLessThanOrEqual(80);
  });

  it("builds the path relative to the output folder", () => {
    expect(dataItemFilePath("email")).toBe("data-items/email.json");
  });
});
