import { CONTROL_PROTOCOL, disconnectedSnapshot, disclosurePreview, validateContactSettings, type ConversationCandidate, type Contact, type ContactSettings, type ControlRequest, type DesktopControlPort, type DesktopSnapshot } from "./control.ts";

import { newerSnapshot, requestPause, requestWithJobs } from "./jobs.ts";
import type { DesktopLifecyclePort, LifecycleCommand, LifecycleResult } from "./lifecycle.ts";

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const icon = (name: "pause" | "play" | "settings" | "search" | "check" | "arrow" | "person") => {
  const paths = { pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="m8 5 11 7-11 7Z"/>', settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="5"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', check: '<path d="m5 12 4 4L19 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};
const capabilityNames = { messages: "Messages", contacts: "Contacts", agent: "Agent account", attachments: "File attachments", reactions: "Reactions", stickers: "Stickers", links: "Rich links", polls: "Polls", "mini-apps": "iMessage apps" };
const statusNames = { available: "Available", "setup-required": "Setup required", unsupported: "Unavailable" };
const routeNames = { "claude-api": "Claude API", "claude-code": "Claude Code", codex: "Codex" };
type Tab = "behavior" | "memory" | "activity" | "setup";

export function mountPanel(root: HTMLElement, port: DesktopControlPort, lifecycle?: DesktopLifecyclePort): void {
  let snapshot: DesktopSnapshot = disconnectedSnapshot();
  let selected: string | null = null;
  let tab: Tab = "behavior";
  let search = "";
  let adding = false; let candidates: ConversationCandidate[] = []; let candidateId = ""; let initializeHistory = false; let conversationDetail = "";
  let draft: ContactSettings | null = null;
  let memory = ""; let savedMemory = ""; let memoryRevision = ""; let memoryLoaded = false;
  let globalDraft = { ...snapshot.settings };
  let busy = true; let ownerJobPending = false; let pauseBusy = false; let feedback = ""; let feedbackError = false;
  let lifecycleBusy = false; let service: LifecycleResult | null = null;
  const current = () => snapshot.contacts.find(contact => contact.id === selected);
  const dirty = () => (draft !== null && JSON.stringify(draft) !== JSON.stringify(current()?.settings)) || memory !== savedMemory || JSON.stringify(globalDraft) !== JSON.stringify(snapshot.settings);
  const editable = () => snapshot.connection !== "disconnected" && !busy && !pauseBusy && !lifecycleBusy;
  function announce(message: string, error = false) {
    feedback = message; feedbackError = error;
    const live = root.querySelector<HTMLElement>("#feedback");
    if (live) { live.textContent = message; live.classList.toggle("error", error); }
  }
  function resetDraft() { draft = current() ? structuredClone(current()!.settings) : null; globalDraft = { ...snapshot.settings }; memory = ""; savedMemory = ""; memoryLoaded = false; }
  async function request(request: ControlRequest, success?: string, preserveDrafts = false): Promise<void> {
    busy = true; render();
    try {
      const response = await requestWithJobs(port, request, undefined, () => { ownerJobPending = true; render(); });
      if (!response.ok) { announce(response.message, true); return; }
      if (response.kind === "conversations") {
        candidates = response.candidates; candidateId = ""; conversationDetail = response.detail;
      } else if (response.kind === "enrolled") {
        snapshot = newerSnapshot(snapshot, response.snapshot); selected = response.contactId; adding = false; tab = "behavior"; resetDraft();
        announce(response.historyInitialized ? `Contact added with ${response.historyCount} recent messages as context. ${response.historyShortenedCount} shortened; ${response.historyOmittedCount} omitted. The butler is off.` : "Contact added. No message history was imported. The butler is off.");
      } else if (response.kind === "snapshot") {
        const stale = response.snapshot.revision < snapshot.revision;
        snapshot = newerSnapshot(snapshot, response.snapshot);
        if (selected && !snapshot.contacts.some(contact => contact.id === selected)) selected = null;
        if (request.command === "snapshot" && !selected && snapshot.contacts[0]) selected = snapshot.contacts[0].id;
        if (preserveDrafts) globalDraft.paused = snapshot.settings.paused;
        if (request.command !== "activity.list" && !preserveDrafts && !stale) {
          const previousMemory = memory;
          resetDraft();
          if (request.command === "contact.memory.write") { memory = previousMemory; savedMemory = previousMemory; memoryLoaded = true; memoryRevision = ""; memoryLoaded = false; }
        }
      } else if (response.kind === "memory") {
        if (response.contactId !== selected) throw new Error("Memory response does not match the selected contact.");
        memory = response.content; savedMemory = memory; memoryLoaded = true; memoryRevision = response.revision;
      }
      if (success) announce(success);
    } catch (error) { announce(error instanceof Error ? error.message : "The daemon could not complete the request.", true); }
    finally { busy = false; ownerJobPending = false; render(); }
  }
  async function togglePause(): Promise<void> {
    if (pauseBusy || snapshot.connection === "disconnected") return;
    const paused = !snapshot.settings.paused;
    pauseBusy = true; render();
    try {
      const response = await requestPause(port, snapshot, paused);
      if (!response.ok) { announce(response.message, true); return; }
      if (response.kind !== "snapshot") throw new Error("The daemon returned an unexpected global pause response.");
      snapshot = newerSnapshot(snapshot, response.snapshot);
      globalDraft.paused = snapshot.settings.paused;
      announce(paused ? "All contacts paused. Unsaved edits are preserved." : "Global pause lifted. Contact settings still apply.");
    } catch (error) { announce(error instanceof Error ? error.message : "The daemon could not change global pause.", true); }
    finally { pauseBusy = false; render(); }
  }
  function contactList(): string {
    const contacts = snapshot.contacts.filter(contact => contact.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    if (!contacts.length) return `<p class="sidebar-empty">${snapshot.connection === "disconnected" ? "Connect the daemon to choose contacts." : "No matching contacts."}</p>`;
    return contacts.map(contact => `<button class="contact ${contact.id === selected ? "selected" : ""}" data-contact="${escape(contact.id)}" aria-pressed="${contact.id === selected}"><span class="avatar small">${escape(initials(contact))}</span><span class="contact-copy"><strong>${escape(contact.name)}</strong><span>${contact.settings.enabled ? (snapshot.settings.paused ? "Paused globally" : contact.settings.responseMode === "smart" ? "Smart response" : "Keyword only") : "Butler off"}</span></span><span class="contact-status ${contact.settings.enabled && !snapshot.settings.paused ? "active" : ""}" aria-label="${contact.settings.enabled ? "Enabled" : "Disabled"}"></span></button>`).join("");
  }
  function initials(contact: Contact): string { return contact.name.split(/\s+/u).slice(0, 2).map(word => [...word][0] ?? "").join("").toLocaleUpperCase(); }
  function setup(): string {
    const messaging = snapshot.messagingProviders?.length ? `<section class="section"><h2>Messaging connections</h2><p class="section-description">Connect the configured account before choosing conversations. WhatsApp sync runs in the background after you start it.</p><p class="quiet-note">${escape(snapshot.automation?.detail ?? "Messaging setup is required.")}</p><div class="form-actions">${snapshot.messagingProviders.map(provider => `<button class="button" data-messaging-start="${provider}" ${!editable() ? "disabled" : ""}>${provider === "whatsapp" ? "Start WhatsApp sync" : "Connect iMessage"}</button>`).join("")}</div></section>` : "";
    const native = lifecycle ? `<section class="section"><h2>Background service</h2><p class="section-description">Keep Textbutler running while its window is closed. Your Mac must remain awake and signed in.</p><p role="status">${escape(lifecycleBusy ? "Updating the background service…" : service?.detail ?? "Check the service before installing it. New installations start paused.")}</p><div class="form-actions"><button class="button" data-lifecycle="status" ${lifecycleBusy || busy ? "disabled" : ""}>Check service</button><button class="button" data-lifecycle="uninstall" ${lifecycleBusy || busy || service?.status !== "completed" || service.installation !== "installed" ? "disabled" : ""}>Uninstall service</button><button class="button primary" data-lifecycle="install" ${lifecycleBusy || busy || service?.status !== "completed" || service.installation !== "absent" ? "disabled" : ""}>Install service</button></div><p class="quiet-note">Uninstalling preserves your contacts, settings, and memory.</p></section>` : "";
    const providers = `<section class="section"><h2>Agent accounts</h2><p class="section-description">Choose an account for each contact in Behavior. Claude API uses separate API billing; it does not use a Claude Code subscription.</p><div class="capability-list">${snapshot.providerAccounts?.length ? snapshot.providerAccounts.map(account => `<div class="capability-row"><div><strong>${escape(account.label)} · ${routeNames[account.route]}</strong><p>${escape(account.detail)}</p>${account.status === "ready" ? `<p>Replies: ${escape(account.defaultReplyModel ?? "Unavailable")}<br>Classifier: ${escape(account.classifierModel ?? "Unavailable")}</p>` : ""}${account.route === "claude-api" ? `<button class="button" data-provider-check="${escape(account.id)}" ${!editable() ? "disabled" : ""}>Check account</button>` : ""}</div><span class="capability-state ${account.status === "ready" ? "available" : account.status === "unavailable" ? "unsupported" : "setup-required"}">${account.status === "ready" ? "Ready" : account.status === "unavailable" ? "Unavailable" : "Setup required"}</span></div>`).join("") : `<p class="quiet-note">Configured accounts appear here when the daemon is connected.</p>`}</div><p class="quiet-note">An account check verifies model access without sending a message or paid prompt. Credentials are managed in the private host configuration and never displayed here.</p></section>`;
    return `${native}${messaging}${providers}<section class="section"><h2>Connection & capabilities</h2><p class="section-description">Textbutler uses Ghostget for messaging and contacts. Each feature becomes available after the connected provider confirms it.</p><div class="capability-list">${snapshot.capabilities.map(capability => `<div class="capability-row"><div><strong>${capabilityNames[capability.id]}</strong><p>${escape(capability.detail)}</p></div><span class="capability-state ${capability.status}">${statusNames[capability.status]}</span></div>`).join("")}</div></section>`;
  }
  async function manageService(command: LifecycleCommand): Promise<void> {
    if (!lifecycle || lifecycleBusy || busy) return;
    if (dirty()) { announce("Save or discard your edits before changing the background service.", true); return; }
    lifecycleBusy = true; render();
    try {
      service = await lifecycle.request(command);
      announce(service.detail, !service.ok);
      if (service.status === "completed") await request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
    } catch { service = { ok: false, status: "indeterminate", installation: "indeterminate", service: "unknown", detail: "The service operation could not be verified. Check service status before making another change." }; announce(service.detail, true); }
    finally { lifecycleBusy = false; render(); }
  }
  function behavior(): string {
    if (!draft) return "";
    const accounts = snapshot.providerAccounts, matched = accounts?.find(account => account.id === draft!.accountId && account.provider === draft!.provider);
    const accountPicker = accounts?.length ? `<div class="setting-row"><label for="provider-account"><strong>Agent account</strong><span>API accounts use separate API billing.</span></label><select id="provider-account" name="accountId" ${!editable() ? "disabled" : ""}>${!matched ? `<option value="" selected disabled>${draft.provider === "claude" ? "Claude Code" : "Codex"} · Account not configured</option>` : ""}${accounts.map(account => `<option value="${escape(account.id)}" ${matched?.id === account.id ? "selected" : ""}>${escape(account.label)} · ${routeNames[account.route]}</option>`).join("")}</select></div>` : `<div class="setting-row"><label for="provider"><strong>Agent provider</strong><span>Choose a coding-agent provider.</span></label><select id="provider" name="provider" ${!editable() ? "disabled" : ""}><option value="codex" ${draft.provider === "codex" ? "selected" : ""}>Codex</option><option value="claude" ${draft.provider === "claude" ? "selected" : ""}>Claude Code</option></select></div>`;
    return `<form id="behavior-form"><section class="section"><div class="setting-row activation-row"><div><h2>Butler for this contact</h2><p>Allow the butler to respond in this conversation.</p></div><label class="switch"><input type="checkbox" name="enabled" ${draft.enabled ? "checked" : ""} aria-label="Enable butler for this contact" ${!editable() ? "disabled" : ""}><span></span></label></div></section>
      ${current()?.messaging ? `<section class="section"><p class="section-description">${escape(current()!.messaging!.detail)}</p>${current()!.messaging!.grantExpiresAt ? `<p class="quiet-note">Current grant expires ${escape(new Date(current()!.messaging!.grantExpiresAt!).toLocaleString())}.</p>` : ""}</section>` : ""}
      <section class="section"><h2>When to respond</h2><fieldset class="mode-options" ${!editable() ? "disabled" : ""}><legend class="sr-only">Response mode</legend><label class="mode-option"><input type="radio" name="responseMode" value="smart" ${draft.responseMode === "smart" ? "checked" : ""}><span><strong>Smart response</strong><span>Step in when helpful. Stay quiet while you’re actively talking.</span></span></label><label class="mode-option"><input type="radio" name="responseMode" value="keyword" ${draft.responseMode === "keyword" ? "checked" : ""}><span><strong>Keyword only</strong><span>Respond when this contact asks for the butler by name.</span></span></label></fieldset>
      <div class="setting-row"><label for="keyword"><strong>Trigger keyword</strong><span>Always available, including in smart mode.</span></label><input id="keyword" name="keyword" type="text" maxlength="40" value="${escape(draft.keyword)}" ${!editable() ? "disabled" : ""}></div>
      ${accountPicker}<p class="quiet-note">The daemon selects a low-cost classifier from this account’s verified models and price catalog. Account readiness is shown in the Setup tab.</p></section>
      <section class="section"><h2>Make the butler recognizable</h2><p class="section-description">Every reply is wrapped with these three symbols. Each field accepts one character or emoji.</p><div class="symbols"><label for="character">Character<input id="character" name="character" value="${escape(draft.disclosure.character)}" maxlength="16" ${!editable() ? "disabled" : ""}></label><label for="begin">Begin<input id="begin" name="begin" value="${escape(draft.disclosure.begin)}" maxlength="16" ${!editable() ? "disabled" : ""}></label><label for="end">End<input id="end" name="end" value="${escape(draft.disclosure.end)}" maxlength="16" ${!editable() ? "disabled" : ""}></label><div class="preview"><span>Reply preview</span><output id="disclosure-preview">${escape(disclosurePreview(draft))}</output></div></div></section>
      <div class="form-actions"><span id="dirty-state">${dirty() ? "Unsaved changes" : "Settings are up to date"}</span><button type="button" class="button" data-action="discard" ${!editable() ? "disabled" : ""}>Discard changes</button><button type="submit" class="button primary" ${!editable() ? "disabled" : ""}>${busy ? "Saving…" : "Save settings"}</button></div></form>`;
  }
  function memoryView(): string {
    return `<section class="section memory-section"><h2>What your butler remembers</h2><p class="section-description">Guidance and context for this contact. The butler can update this memory as it learns; your edits take priority.</p>${!memoryLoaded ? `<div class="empty-state compact"><p>${busy ? "Loading contact memory…" : "Load this contact’s memory to review or edit it."}</p><button class="button" data-action="load-memory" ${!editable() ? "disabled" : ""}>Load memory</button></div>` : `<form id="memory-form"><div class="section-heading memory-heading"><label for="memory" class="memory-label">Contact memory</label><button class="button" type="button" data-action="load-memory" ${!editable() ? "disabled" : ""}>Reload memory</button></div><textarea id="memory" name="memory" spellcheck="false" maxlength="65536" ${!editable() ? "disabled" : ""}>${escape(memory)}</textarea><div class="form-actions"><span id="memory-state">${memory !== savedMemory ? "Unsaved changes" : "Memory is up to date"}</span><button type="button" class="button" data-action="discard-memory" ${!editable() ? "disabled" : ""}>Discard changes</button><button class="button primary" type="submit" ${!editable() ? "disabled" : ""}>Save memory</button></div></form>`}</section>`;
  }
  function activityView(): string {
    const events = snapshot.activity.filter(event => event.contactId === selected || event.contactId === null);
    return `<section class="section"><div class="section-heading"><h2>Activity</h2><button class="button" data-action="refresh-activity" ${!editable() ? "disabled" : ""}>Refresh</button></div><p class="section-description">Decisions and actions reported by the daemon.</p>${events.length ? `<ol class="activity-list">${events.map(event => `<li><span class="event-mark">${icon("check")}</span><div><strong>${escape(event.title)}</strong><p>${escape(event.detail)}</p><time datetime="${escape(event.at)}">${escape(Number.isNaN(Date.parse(event.at)) ? "Time unavailable" : new Date(event.at).toLocaleString())}</time></div></li>`).join("")}</ol>` : `<div class="empty-state compact">${icon("check")}<h3>No activity yet</h3><p>${snapshot.connection === "demo" ? "This preview contains no messages. Saved sample settings appear here." : "Decisions will appear after the daemon is connected and this contact is enabled."}</p></div>`}</section>`;
  }
  function globalView(): string {
    return `<header class="inspector-heading"><div><h1>Textbutler settings</h1><p>Set boundaries for every contact.</p></div></header><div class="inspector-content"><form id="global-form"><section class="section"><h2>Availability</h2><div class="setting-row"><label for="global-paused"><strong>Pause all contacts</strong><span>Keep settings and memory while replies are paused.</span></label><label class="switch"><input id="global-paused" name="paused" type="checkbox" ${globalDraft.paused ? "checked" : ""} ${!editable() ? "disabled" : ""}><span></span></label></div><div class="setting-row"><label for="active-limit"><strong>Active contact limit</strong><span>${snapshot.contacts.filter(contact => contact.settings.enabled).length} contacts currently enabled. Default: 5.</span></label><input id="active-limit" name="activeContactLimit" type="number" min="1" max="50" step="1" value="${globalDraft.activeContactLimit}" ${!editable() ? "disabled" : ""}></div><p class="quiet-note">Disable contacts before lowering this below the active count.</p></section><div class="form-actions"><span id="dirty-state">${dirty() ? "Unsaved changes" : "Settings are up to date"}</span><button class="button" type="button" data-action="discard" ${!editable() ? "disabled" : ""}>Discard changes</button><button class="button primary" ${!editable() ? "disabled" : ""}>Save settings</button></div></form>${setup()}</div>`;
  }
  function enrollmentView(): string {
    return `<header class="inspector-heading"><div><h1>Messaging conversations</h1><p>Choose one person to give their butler a home.</p></div><button class="button" data-action="close-enrollment" ${busy ? "disabled" : ""}>Cancel</button></header><div class="inspector-content"><section class="section"><div class="section-heading"><h2>Choose a conversation</h2><button class="button" data-action="refresh-conversations" ${!editable() ? "disabled" : ""}>Refresh</button></div><p class="section-description">${escape(conversationDetail || "Textbutler reads recent conversation names and participants through Ghostget. The native Contacts directory is not available.")}</p>${busy ? `<p role="status" class="quiet-note">Reading through Ghostget… This can take a moment.</p>` : ""}<form id="enrollment-form"><fieldset class="conversation-picker" ${!editable() ? "disabled" : ""}><legend class="sr-only">Messaging conversations</legend>${candidates.length ? candidates.map(candidate => `<label class="conversation-option ${candidate.eligible ? "" : "unavailable"}"><input type="radio" name="candidateId" value="${escape(candidate.id)}" ${candidateId === candidate.id ? "checked" : ""} ${!candidate.eligible ? "disabled" : ""}><span><strong>${escape(candidate.name)}</strong><span>${escape(candidate.subtitle)}</span>${!candidate.eligible ? `<span>${escape(candidate.reason)}</span>` : ""}</span></label>`).join("") : `<p class="quiet-note">${busy ? "Loading conversations…" : "No conversations to show. Check Ghostget setup, then refresh."}</p>`}</fieldset><div class="history-choice"><label><input type="checkbox" name="initializeHistory" ${initializeHistory ? "checked" : ""} ${!editable() ? "disabled" : ""}><strong>Initialize from recent history</strong></label><p>Copy up to 200 recent text messages from this conversation into its private context folder. Long messages are shortened to keep the import bounded. History is context only and never triggers a reply.</p></div><p class="quiet-note">This adds a disabled contact. Account and participants are checked again before enrollment and activation. Attachments are not imported.</p><div class="form-actions"><span>No messages will be sent.</span><button id="enroll-contact" class="button primary" type="submit" ${!editable() || !candidateId ? "disabled" : ""}>Add contact</button></div></form></section></div>`;
  }
  function render() {
    const contact = current();
    root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon("person")}</span><strong>Textbutler</strong></div><div class="connection-summary"><span class="status-dot ${snapshot.connection === "connected" ? "connected" : ""}"></span><span>${snapshot.connection === "demo" ? "Synthetic preview" : snapshot.connection === "connected" ? snapshot.settings.paused ? "All contacts paused" : "Daemon connected" : "Daemon disconnected"}</span></div><button class="button pause-button" data-action="pause" ${snapshot.connection === "disconnected" || pauseBusy || busy && !ownerJobPending ? "disabled" : ""}>${icon(snapshot.settings.paused ? "play" : "pause")}${snapshot.settings.paused ? "Resume all" : "Pause all"}</button><div class="sidebar-heading"><h2>Contacts</h2><span>${snapshot.contacts.filter(contact => contact.settings.enabled).length} / ${snapshot.settings.activeContactLimit} active</span></div><button class="button add-contact-button" data-action="add-contact" ${!editable() ? "disabled" : ""}>Add contact…</button><label class="search-field">${icon("search")}<input id="contact-search" type="search" placeholder="Find a contact" value="${escape(search)}" aria-label="Find a contact"></label><nav id="contact-list" class="contact-list" aria-label="Contacts">${contactList()}</nav><div class="sidebar-footer"><button class="settings-nav ${selected === null ? "selected" : ""}" data-action="global">${icon("settings")}<span>Settings & setup</span></button></div></aside><main class="inspector">${snapshot.connection === "demo" ? `<div class="mode-banner">Synthetic preview <span>Sample contacts only. Changes reset when this page closes.</span></div>` : ""}${snapshot.connection === "disconnected" ? `<div class="connection-banner"><div><strong>${busy ? "Connecting to Textbutler…" : "Connect your local daemon"}</strong><span>${escape(snapshot.detail)} No replies are being sent.</span></div><button class="button" data-action="reconnect" ${busy ? "disabled" : ""}>Retry connection</button></div>` : ""}${adding ? enrollmentView() : contact ? `<header class="inspector-heading"><span class="avatar large">${escape(initials(contact))}</span><div><h1>${escape(contact.name)}</h1><p>${escape(contact.subtitle)}</p></div><span class="contact-label">${contact.settings.enabled ? snapshot.settings.paused ? "Paused" : "Butler enabled" : "Butler off"}</span></header><nav class="tabs" aria-label="Contact sections">${(["behavior", "memory", "activity", "setup"] as const).map(value => `<button data-tab="${value}" aria-current="${tab === value ? "page" : "false"}" class="${tab === value ? "active" : ""}">${({ behavior: "Behavior", memory: "Memory", activity: "Activity", setup: "Setup" })[value]}</button>`).join("")}</nav><div class="inspector-content">${tab === "behavior" ? behavior() : tab === "memory" ? memoryView() : tab === "activity" ? activityView() : setup()}</div>` : globalView()}<div id="feedback" class="feedback ${feedbackError ? "error" : ""}" role="status" aria-live="polite">${escape(feedback)}</div></main></div>`;
  }
  root.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (target.name === "candidateId") { candidateId = target.value; const submit = root.querySelector<HTMLButtonElement>("#enroll-contact"); if (submit) submit.disabled = !editable() || !candidateId; return; }
    if (target.name === "initializeHistory" && target instanceof HTMLInputElement) { initializeHistory = target.checked; return; }
    if (target.id === "contact-search") { search = target.value; root.querySelector("#contact-list")!.innerHTML = contactList(); return; }
    if (target.name === "memory") { memory = target.value; root.querySelector("#memory-state")!.textContent = memory === savedMemory ? "Memory is up to date" : "Unsaved changes"; return; }
    if (draft && target.closest("#behavior-form")) {
      if (target.name === "enabled" && target instanceof HTMLInputElement) draft.enabled = target.checked;
      if (target.name === "responseMode" && (target.value === "smart" || target.value === "keyword")) draft.responseMode = target.value;
      if (target.name === "keyword") draft.keyword = target.value;
      if (target.name === "provider" && (target.value === "codex" || target.value === "claude")) draft.provider = target.value;
      if (target.name === "accountId") { const account = snapshot.providerAccounts?.find(account => account.id === target.value); if (account) { draft.accountId = account.id; draft.provider = account.provider; } }
      if (target.name === "character" || target.name === "begin" || target.name === "end") draft.disclosure[target.name] = target.value;
      const preview = root.querySelector("#disclosure-preview"); if (preview) preview.textContent = disclosurePreview(draft);
    }
    if (target.closest("#global-form")) {
      if (target.name === "paused" && target instanceof HTMLInputElement) globalDraft.paused = target.checked;
      if (target.name === "activeContactLimit") globalDraft.activeContactLimit = Number(target.value);
    }
    const status = root.querySelector("#dirty-state"); if (status) status.textContent = dirty() ? "Unsaved changes" : "Settings are up to date";
  });
  root.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button"); if (!button || button.disabled || pauseBusy || busy && !(button.dataset.action === "pause" && ownerJobPending)) return;
    if (button.dataset.lifecycle && ["status", "install", "uninstall"].includes(button.dataset.lifecycle)) { void manageService(button.dataset.lifecycle as LifecycleCommand); return; }
    if (button.dataset.providerCheck) {
      if (dirty()) { announce("Save or discard your edits before checking an account.", true); return; }
      void request({ protocol: CONTROL_PROTOCOL, command: "provider.accounts.check", accountId: button.dataset.providerCheck }, "Account model access verified."); return;
    }
    if (button.dataset.messagingStart === "imessage" || button.dataset.messagingStart === "whatsapp") {
      if (dirty()) { announce("Save or discard your edits before connecting messaging.", true); return; }
      void request({ protocol: CONTROL_PROTOCOL, command: "messaging.start", provider: button.dataset.messagingStart }, "Messaging connection verified."); return;
    }
    if (button.dataset.contact || button.dataset.action === "global") {
      if (dirty()) { announce("Save or discard your edits before switching contacts.", true); return; }
      adding = false; selected = button.dataset.contact ?? null; tab = "behavior"; resetDraft(); feedback = ""; render(); return;
    }
    if (button.dataset.action === "add-contact") {
      if (dirty()) { announce("Save or discard your edits before adding a contact.", true); return; }
      adding = true; candidates = []; candidateId = ""; initializeHistory = false; conversationDetail = ""; feedback = "";
      void request({ protocol: CONTROL_PROTOCOL, command: "conversations.list" }); return;
    }
    if (button.dataset.action === "close-enrollment") { adding = false; feedback = ""; render(); return; }
    if (button.dataset.action === "refresh-conversations") { candidateId = ""; void request({ protocol: CONTROL_PROTOCOL, command: "conversations.list" }); return; }
    const newTab = button.dataset.tab as Tab | undefined;
    if (newTab) { if (dirty()) { announce("Save or discard your edits before switching sections.", true); return; } feedback = ""; tab = newTab; render(); if (tab === "memory" && !memoryLoaded && selected) void request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.read", contactId: selected }); return; }
    if (button.dataset.action === "discard") { resetDraft(); announce("Changes discarded."); render(); }
    if (button.dataset.action === "discard-memory") { memory = savedMemory; announce("Changes discarded."); render(); }
    if (button.dataset.action === "reconnect") void request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
    if (button.dataset.action === "load-memory" && selected && memory !== savedMemory) { announce("Save or discard your memory edits before reloading.", true); return; }
    if (button.dataset.action === "load-memory" && selected) void request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.read", contactId: selected });
    if (button.dataset.action === "refresh-activity") void request({ protocol: CONTROL_PROTOCOL, command: "activity.list" });
    if (button.dataset.action === "pause") void togglePause();
  });
  root.addEventListener("submit", event => {
    event.preventDefault(); if (busy || !editable() || !(event.target instanceof HTMLFormElement)) return;
    if (event.target.id === "enrollment-form") {
      if (!candidates.some(candidate => candidate.id === candidateId && candidate.eligible)) { announce("Choose an eligible conversation.", true); return; }
      void request({ protocol: CONTROL_PROTOCOL, command: "contact.enroll", candidateId, expectedRevision: snapshot.revision, initializeHistory });
    } else if (event.target.id === "behavior-form" && draft && selected) {
      const error = validateContactSettings(draft); if (error) { announce(error, true); return; }
      void request({ protocol: CONTROL_PROTOCOL, command: "contact.settings.update", contactId: selected, expectedRevision: snapshot.revision, settings: structuredClone(draft) }, "Contact settings saved.");
    } else if (event.target.id === "memory-form" && selected) {
      void request({ protocol: CONTROL_PROTOCOL, command: "contact.memory.write", contactId: selected, expectedRevision: memoryRevision, content: memory }, "Contact memory saved.");
    } else if (event.target.id === "global-form") {
      void request({ protocol: CONTROL_PROTOCOL, command: "global.settings.update", expectedRevision: snapshot.revision, settings: { ...globalDraft } }, "Global settings saved.");
    }
  });
  render(); void request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
}
