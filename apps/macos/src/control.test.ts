import { describe, expect, test } from "bun:test";
import { CONTROL_PROTOCOL, DEFAULT_CONTACT_SETTINGS, disconnectedSnapshot, disclosurePreview, parseControlResponse, validateContactSettings } from "./control.ts";
import { createDemoPort } from "./demo-port.ts";

describe("desktop control boundary", () => {
  test("rejects incompatible, oversized and duplicate daemon state", () => {
    expect(() => parseControlResponse({ protocol: "other", ok: false })).toThrow("incompatible");
    const snapshot = disconnectedSnapshot();
    snapshot.capabilities.push(snapshot.capabilities[0]!);
    expect(() => parseControlResponse({ protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot })).toThrow();
    expect(() => parseControlResponse({ protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: "one", revision: 1, content: "hello" })).toThrow("digest");
    expect(() => parseControlResponse({ protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: "one", revision: "a".repeat(64), content: "x".repeat(65_537) })).toThrow();
  });
  test("disclosure accepts a joined emoji and rejects control text or multiple symbols", () => {
    const settings = structuredClone(DEFAULT_CONTACT_SETTINGS);
    expect(disclosurePreview(settings, "hello")).toBe("🤖{ hello }");
    settings.disclosure.character = "👨‍👩‍👧";
    expect(validateContactSettings(settings)).toBeNull();
    settings.disclosure.character = "ab";
    expect(validateContactSettings(settings)).not.toBeNull();
    settings.disclosure.character = "\n";
    expect(validateContactSettings(settings)).not.toBeNull();
    settings.disclosure.character = "\u202e";
    expect(validateContactSettings(settings)).not.toBeNull();
    settings.disclosure.character = "\u200d";
    expect(validateContactSettings(settings)).not.toBeNull();
    settings.disclosure.character = "\u0301";
    expect(validateContactSettings(settings)).not.toBeNull();
    settings.disclosure.character = "🤖";
    settings.keyword = "a".repeat(41);
    expect(validateContactSettings(settings)).not.toBeNull();
  });
  test("native disconnected snapshot has no fabricated contacts or activity", () => {
    const snapshot = disconnectedSnapshot();
    expect(snapshot.connection).toBe("disconnected");
    expect(snapshot.contacts).toEqual([]);
    expect(snapshot.activity).toEqual([]);
    expect(snapshot.settings.paused).toBe(true);
    expect(snapshot.capabilities.some(capability => capability.status === "available")).toBe(false);
  });
});

describe("separate synthetic preview", () => {
  test("capacity and stale settings are rejected without mutation", async () => {
    const port = createDemoPort();
    const initial = await port.request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
    if (!initial.ok || initial.kind !== "snapshot") throw new Error("Missing snapshot");
    const bad = await port.request({ protocol: CONTROL_PROTOCOL, command: "global.settings.update", expectedRevision: 0, settings: { paused: false, activeContactLimit: 1 } });
    expect(bad.ok).toBe(false);
    const limit = await port.request({ protocol: CONTROL_PROTOCOL, command: "global.settings.update", expectedRevision: 0, settings: { paused: false, activeContactLimit: 2 } });
    expect(limit.ok).toBe(true);
    const settings = { ...structuredClone(DEFAULT_CONTACT_SETTINGS), enabled: true };
    const stale = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.settings.update", contactId: "synthetic-jamie", expectedRevision: 0, settings });
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
    const full = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.settings.update", contactId: "synthetic-jamie", expectedRevision: 1, settings });
    expect(full).toMatchObject({ ok: false, code: "capacity" });
  });
  test("memory writes use content digests and preserve concurrent edits", async () => {
    const port = createDemoPort();
    const memory = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.read", contactId: "synthetic-alex" });
    if (!memory.ok || memory.kind !== "memory") throw new Error("Missing memory");
    expect(memory.revision).toMatch(/^[a-f0-9]{64}$/u);
    const first = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.write", contactId: "synthetic-alex", expectedRevision: memory.revision, content: "First edit" });
    expect(first.ok).toBe(true);
    const stale = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.write", contactId: "synthetic-alex", expectedRevision: memory.revision, content: "Stale edit" });
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
    const readback = await port.request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.read", contactId: "synthetic-alex" });
    expect(readback).toMatchObject({ ok: true, content: "First edit" });
    const fresh = await createDemoPort().request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.read", contactId: "synthetic-alex" });
    expect(fresh).not.toMatchObject({ content: "First edit" });
  });
});
