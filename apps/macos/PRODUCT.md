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

Smart response is the default; a configurable keyword defaults to `butler`. Each contact has an enabled setting, Codex or Claude provider, and three configurable disclosure symbols, defaulting to `🤖`, `{`, `}`. A configurable contact limit defaults to five. Native mode connects to the private owner control socket for settings, activity, contact memory, and an explicit Messages conversation picker; an absent daemon shows a disconnected state. The separate browser preview uses synthetic data. Neither mode starts an agent, sends a message, or reads Messages or Contacts directly. The owner can list up to 200 recent conversations through their configured Ghostget CLI, choose a verified one-to-one conversation, and optionally initialize its private folder with up to 200 recent text messages. Enrollment creates a disabled contact and records any shortened or omitted context. Trusted account/conversation bindings stay outside agent memory and confer no send authority. Long reads use bounded owner jobs; global pause remains usable while those jobs run. Autonomous messaging remains unavailable until the transport and agent boundary qualify.

## Brand Commitments

Textbutler. Native-feeling macOS controls follow the user's Ghostget reference. This surface is an operating tool with quiet, legible controls.

## Evidence on Hand

User requirements, the existing Message Like Me evidence design, and Ghostget's public desktop structure. Preview contacts and memory are explicitly synthetic; there is no live activity evidence.
