import type { DesktopSnapshot } from "./control.ts";

/** The compact marks used by the shared Hraness utilities rail. Keep these
 * textual so the menu bar remains legible at macOS menu-bar sizes. */
export const APP_MARKS = Object.freeze({ agentrouter: "AI", slopcamera: "Sl", peopleblade: "Pe", oompa: "Oo", textbutler: "Tb" });

export type MenuBarTone = "connected" | "paused" | "preview" | "offline" | "setup";
export interface MenuBarModel {
  status: string;
  tone: MenuBarTone;
  paused: boolean;
  activeContacts: number;
  activeLimit: number;
  contactCount: number;
  readyAccounts: number;
  availableCapabilities: number;
  capabilityCount: number;
  gettingStarted: string;
  detail: string;
}

export function buildMenuBarModel(snapshot: DesktopSnapshot): MenuBarModel {
  const activeContacts = snapshot.contacts.filter(contact => contact.settings.enabled).length;
  const readyAccounts = snapshot.providerAccounts?.filter(account => account.status === "ready").length ?? 0;
  const availableCapabilities = snapshot.capabilities.filter(capability => capability.status === "available").length;
  const setupNeeded = snapshot.connection === "disconnected" || readyAccounts === 0 || snapshot.capabilities.some(capability => capability.status === "setup-required");
  const tone: MenuBarTone = snapshot.connection === "demo" ? "preview" : snapshot.connection === "disconnected" ? "offline" : snapshot.settings.paused ? "paused" : setupNeeded ? "setup" : "connected";
  const status = snapshot.connection === "demo" ? "Preview" : snapshot.connection === "disconnected" ? "Offline" : snapshot.settings.paused ? "Paused" : setupNeeded ? "Setup needed" : "Ready";
  const gettingStarted = snapshot.connection === "disconnected"
    ? "Connect the local daemon"
    : snapshot.contacts.length === 0
      ? "Add your first contact"
      : readyAccounts === 0
        ? "Connect an agent account"
        : snapshot.capabilities.some(capability => capability.status === "setup-required")
          ? "Finish messaging setup"
          : "Your butler is ready";
  return {
    status, tone, paused: snapshot.settings.paused, activeContacts, activeLimit: snapshot.settings.activeContactLimit,
    contactCount: snapshot.contacts.length, readyAccounts, availableCapabilities, capabilityCount: snapshot.capabilities.length,
    gettingStarted, detail: snapshot.detail,
  };
}

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Render the small popover mounted in the settings window. Native tray menus
 * can use the same model, keeping the wording and states consistent. */
export function menuBarMarkup(model: MenuBarModel): string {
  const marks = Object.entries(APP_MARKS).map(([id, mark]) => `<span class="menu-app-mark" data-app="${id}" title="${id}">${mark}</span>`).join("");
  return `<header class="menu-bar" aria-label="Textbutler menu bar"><div class="menu-app-rail">${marks}</div><button class="menu-trigger" data-menu-action="toggle" aria-expanded="false"><span class="menu-brand-mark">${APP_MARKS.textbutler}</span><span class="menu-status-dot ${model.tone}"></span><span>Textbutler</span><span class="menu-status-label">${escape(model.status)}</span><span class="menu-chevron" aria-hidden="true">⌄</span></button><div class="menu-popover" data-menu-popover hidden>
    <div class="menu-popover-heading"><strong>Textbutler</strong><span>${escape(model.detail)}</span></div>
    <button class="menu-item menu-getting-started" data-menu-action="getting-started"><span class="menu-item-copy"><strong>Getting started</strong><small>${escape(model.gettingStarted)}</small></span><span aria-hidden="true">›</span></button>
    <div class="menu-stats" aria-label="Textbutler stats"><div><strong>${model.activeContacts}/${model.activeLimit}</strong><span>active</span></div><div><strong>${model.contactCount}</strong><span>contacts</span></div><div><strong>${model.readyAccounts}</strong><span>accounts</span></div><div><strong>${model.availableCapabilities}/${model.capabilityCount}</strong><span>features</span></div></div>
    <div class="menu-divider"></div>
    <button class="menu-item" data-menu-action="pause"><span>${model.paused ? "Resume replies" : "Pause replies"}</span><kbd>⌘P</kbd></button>
    <button class="menu-item" data-menu-action="accounts"><span>Manage accounts</span><span aria-hidden="true">›</span></button>
    <button class="menu-item" data-menu-action="web"><span>Open textbutler.app</span><span aria-hidden="true">↗</span></button>
    <button class="menu-item" data-menu-action="refresh"><span>Refresh status</span><span aria-hidden="true">↻</span></button>
    <button class="menu-item" data-menu-action="settings"><span>Open settings</span><kbd>⌘,</kbd></button>
  </div></header>`;
}
