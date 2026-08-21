import { describe, expect, test } from "bun:test";
import { integerOption, parseArguments, rejectUnused } from "./args.ts";

describe("CLI argument parsing", () => {
  test("parses values, flags, and positionals without coercion", () => {
    const parsed = parseArguments(["--data-dir", "/private/data", "contacts", "list", "--json", "--limit=12"]);
    expect(parsed.positionals).toEqual(["contacts", "list"]);
    expect(Object.fromEntries(parsed.options)).toEqual({ "data-dir": "/private/data", limit: "12" });
    expect([...parsed.flags]).toEqual(["json"]);
    expect(integerOption(parsed, "limit", 50, 1, 100)).toBe(12);
    expect(() => rejectUnused(parsed, ["data-dir", "limit"], ["json"])).not.toThrow();
  });

  test("rejects unknown, duplicate, and out-of-range options", () => {
    expect(() => parseArguments(["--wat"])).toThrow("Unknown option");
    expect(() => parseArguments(["--json", "--json"])).toThrow("only once");
    const parsed = parseArguments(["--limit", "999"]);
    expect(() => integerOption(parsed, "limit", 1, 1, 100)).toThrow("between 1 and 100");
  });
});
