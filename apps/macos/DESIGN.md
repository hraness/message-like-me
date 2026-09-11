---
name: Textbutler desktop
description: A quiet macOS control panel for a personal message butler.
colors:
  primary: "#2561c4"
  selection: "#dae5f7"
  selection-ink: "#184b98"
  canvas: "#fbfbfa"
  sidebar: "#f0efed"
  surface: "#ffffff"
  ink: "#22252b"
  muted: "#62666d"
  line: "#dedfdf"
  success: "#297046"
  error: "#ae3434"
  focus: "#4384eb"
  dark-canvas: "#232426"
  dark-sidebar: "#292a2c"
  dark-surface: "#303236"
  dark-ink: "#f0f0f0"
  dark-muted: "#b0b3b8"
  dark-primary: "#548ff0"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'
    fontSize: "12px"
    fontWeight: 500
  memory:
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control: "6px"
  selection: "8px"
  avatar: "50%"
spacing:
  control-gap: "9px"
  section: "24px"
  inspector-inset: "34px"
  compact-inset: "23px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "5px 11px"
    height: "30px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "5px 11px"
  contact-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
    rounded: "{rounded.selection}"
    padding: "11px 10px"
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
    height: "32px"
---

# Textbutler desktop design

## Overview

**Creative North Star: "A composed Mac utility."**

The owner should see which relationship is selected, whether its butler is active, and what can be changed without studying a dashboard. The contact sidebar and single inspector remain stable across Behavior, Memory, Activity, and Setup.

**Key Characteristics:**

- System typography and familiar Mac form controls.
- Quiet surfaces, thin separators, one blue selection color.
- Explicit connection, pause, and capability text.
- Editable memory with visible save and conflict states.

## Colors

Primary blue identifies selection and the main save action. Neutral canvas, sidebar, and field surfaces establish hierarchy without shadows. Success and error colors supplement written feedback. Dark mode follows the system and substitutes the matching dark tokens from the stylesheet.

**The Written State Rule.** Activation, connection, and errors always have a text label; color is a supporting cue.

## Typography

Use the system proportional face for navigation, headings, settings, and feedback. Use the system monospace face only for editable memory. The selected contact is the largest heading. Supporting text remains concise and subordinate.

## Layout

The normal window is 1080 by 830, with a 244-pixel contact sidebar. The minimum native window is 760 by 600. Below the 850-pixel breakpoint the sidebar narrows to 210 pixels, inspector insets tighten, and the disclosure preview stacks below its three inputs. The inspector scrolls independently. Keep contact selection visible while reading a long memory document.

## Elevation & Depth

The interface is flat. Tonal surfaces and hairline borders separate navigation, sections, and controls. Avoid decorative cards and floating shadows. Focus outlines are visible above every surface.

## Shapes

Controls have modest curved corners. Contact selections and memory fields use slightly larger curves. Avatars are circles with initials; the UI does not invent portraits. The activation toggle is a compact pill with a visible moving thumb.

## Components

Behavior contains activation, smart or keyword-only mode, keyword, provider, and the live three-symbol disclosure preview. Memory uses a large text editor, explicit save, reload, discard, and an unsaved-state label. The sidebar pause action preserves unfinished edits. Setup uses a plain capability list with available, setup-required, or unavailable text. Activity records observable configuration or daemon events without manufacturing conversation history.

Switch transitions take 160 milliseconds and disappear when reduced motion is enabled. There is no decorative animation.

## Do's and Don'ts

### Do:

- **Do** keep one selected contact and one clear inspector heading.
- **Do** preserve unsaved memory and settings when pausing replies.
- **Do** disclose synthetic preview data in a persistent banner.
- **Do** show transport limitations in Setup.

### Don't:

- **Don't** show sample contacts in the native connection state.
- **Don't** use a chat transcript to imply unproven live delivery.
- **Don't** add arbitrary native file or shell controls to the webview.
