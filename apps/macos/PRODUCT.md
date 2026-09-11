# Textbutler macOS control panel

<!-- impeccable:product-schema 1 -->

## Platform

web

A bundled local webview inside a macOS-only Tauri 2 app. Root PRODUCT.md owns the product architecture; this record scopes the desktop surface.

## Users

The Mac owner chooses contacts for an agent-assisted butler, reviews the information it remembers, and pauses or adjusts how it responds.

## Product Purpose

Make contact activation, response behavior, scoped memory, and provider readiness visible and controllable without giving the webview direct messaging or agent authority.

## Stack

Delegated implementation choice: TypeScript, local HTML/CSS, Bun build, Tauri 2. The user requested a Ghostget-like macOS wrapper and gave discretion to revise the product.

## Capabilities and Constraints

Smart response is the default; a configurable keyword defaults to `butler`. Each contact has an enabled setting, an explicit agent account, and three configurable disclosure symbols, defaulting to `🤖`, `{`, `}`. A configurable contact limit defaults to five. Native mode connects to the private owner control socket for settings, activity, contact memory, messaging setup and a conversation picker; an absent daemon shows a disconnected state. The separate browser preview uses synthetic data.

The Mac app can explicitly install, inspect or uninstall its bundled daemon as a per-user background service. The webview has no direct messaging or agent authority. Through configured Ghostget accounts, the daemon supports owner-selected one-to-one iMessage and WhatsApp conversations. WhatsApp sync starts only after the owner starts the connection. Enrollment creates a disabled contact, preserves trusted account and conversation bindings outside agent memory, and optionally initializes the contact folder from bounded history with omission metadata. Enrollment alone grants no send authority. Long owner jobs preserve global pause and unsaved drafts.

Enabling a contact requires the current provider, target and agent account to pass their admission checks. The daemon owns event intake, takeover checks, classification, disclosed responses, bounded expiring grants, cancellation and durable dispatch receipts. Rich actions are available only where the configured provider admits them. The optional Claude API route is explicitly labeled and uses separate API billing; it is never selected as a fallback for a coding-agent subscription. Unsupported or unqualified native agent routes remain unavailable. No live messaging or paid model result is implied by synthetic interface tests.

## Brand Commitments

Textbutler. Native-feeling macOS controls follow the user's Ghostget reference. This surface is an operating tool with quiet, legible controls.

## Evidence on Hand

User requirements, the existing Message Like Me evidence design, and Ghostget's public desktop structure. Preview contacts and memory are explicitly synthetic; there is no live activity evidence.
