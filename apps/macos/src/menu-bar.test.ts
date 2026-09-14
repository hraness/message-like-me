import { describe, expect, test } from "bun:test";
import { buildMenuBarModel, menuBarMarkup } from "./menu-bar.ts";
import { disconnectedSnapshot } from "./control.ts";

describe("menu bar model", () => {
  test("uses a compact offline getting-started state", () => {
    const model = buildMenuBarModel(disconnectedSnapshot());
    expect(model.status).toBe("Offline");
    expect(model.tone).toBe("offline");
    expect(model.gettingStarted).toBe("Connect the local daemon");
    expect(model.activeContacts).toBe(0);
  });

  test("derives active counts and ready account state without exposing contact names", () => {
    const snapshot = disconnectedSnapshot();
    snapshot.connection = "connected";
    snapshot.settings.paused = false;
    snapshot.contacts = [
      { id: "one", name: "Private", subtitle: "iMessage", settings: { enabled: true, responseMode: "smart", keyword: "butler", provider: "codex", disclosure: { character: "🤖", begin: "{", end: "}" } } },
      { id: "two", name: "Second", subtitle: "iMessage", settings: { enabled: false, responseMode: "smart", keyword: "butler", provider: "codex", disclosure: { character: "🤖", begin: "{", end: "}" } } },
    ];
    snapshot.providerAccounts = [{ id: "owner", label: "Owner", provider: "codex", route: "codex", status: "ready", detail: "ready", defaultReplyModel: "reply", classifierModel: "cheap" }];
    snapshot.capabilities = snapshot.capabilities.map(capability => ({ ...capability, status: "available" as const }));
    const model = buildMenuBarModel(snapshot);
    expect(model.status).toBe("Ready");
    expect(model.activeContacts).toBe(1);
    expect(model.contactCount).toBe(2);
    expect(model.readyAccounts).toBe(1);
    expect(model.gettingStarted).toBe("Your butler is ready");
  });

  test("renders the two-letter serif marks and bounded menu actions", () => {
    const markup = menuBarMarkup(buildMenuBarModel(disconnectedSnapshot("<private status>")));
    expect(markup).toContain(">AI<");
    expect(markup).toContain(">Sl<");
    expect(markup).toContain(">Pe<");
    expect(markup).toContain(">Oo<");
    expect(markup).toContain('data-menu-action="accounts"');
    expect(markup).toContain('data-menu-action="web"');
    expect(markup).toContain("&lt;private status&gt;");
    expect(markup).not.toContain("Private");
  });
});
