/**
 * TextButler's launch film: group chats ask while you are busy, the reveal, a
 * marked butler reply in a chat you enabled, the pacing defaults, the safety
 * defaults, and an end card that asks your coding agent to set it up. Numbers
 * come from site/app/launch/facts.ts; the status from SITE_STATUS_LABEL.
 */
import { join } from "node:path";

import { launchFacts, LAUNCH_STATUS } from "../../site/app/launch/facts.ts";
import { defineStory } from "./story.ts";
import palette from "./palette.json" with { type: "json" };

const repo = join(import.meta.dir, "../..");

export default () => defineStory({
  id: "textbutler",
  brand: {
    wordmark: "TextButler",
    mark: join(repo, "site/public/marks/textbutler.svg"),
    markAspect: 590 / 588,
    // Read with site-palette.ts from https://textbutler.app in dark mode; see palette.json.
    palette: { values: palette.palette },
    designKit: join(repo, "site/node_modules/@hraness/design-kit"),
  },
  acts: [
    {
      kind: "scatter", headline: "Friends text questions while you're busy.", accents: ["busy."], sample: true,
      cards: [
        { app: "iMessage", glyph: "iM", color: "#7fd498", lines: ["Sam", "When does the market open?"] },
        { app: "WhatsApp", glyph: "W", color: "#b8bb26", lines: ["Priya", "What was that ramen place?"] },
        { app: "Beeper", glyph: "B", color: "#d3869b", lines: ["Alex", "Which train do I take?"] },
      ],
      ghosts: ["3 unread", "Missed question", "Reply later", "12 new messages", "Typing…"],
    },
    { kind: "reveal", tagline: "An AI butler for the chats you choose." },
    { kind: "gallery", headline: "They text the butler. It answers, marked as AI.", accents: ["marked"], sample: true, seconds: 5.134,
      items: [{ image: join(import.meta.dir, 'shared-phone.png'), caption: "Your friends keep using their usual messaging app." }],
    },
    {
      kind: "stats", headline: "It waits its turn.", accents: ["waits"],
      items: [
        { value: launchFacts.debounce.value, label: "for friends to finish typing" },
        { value: launchFacts.cooldown.value, label: "of quiet after you write" },
        { value: launchFacts.hourlyCap.value, label: "replies an hour, at most" },
      ],
    },
    {
      kind: "cards", headline: "You stay in charge of every chat.", accents: ["in", "charge"],
      items: [
        { tag: "Off by default", title: "It starts paused, and every chat starts off" },
        { tag: "Drafts", title: "Check a draft's words and recipient before sending" },
        { tag: "On your Mac", title: "A local model can write replies on your Mac" },
      ],
    },
  ],
  end: {
    lead: "Ask your coding agent:", prompt: "Set up TextButler from textbutler.app",
    terms: `${LAUNCH_STATUS} · Free and MIT licensed · Runs on your Mac`, url: "textbutler.app", finePrint: "Sample chats. People shown are fictional.",
  },
  formats: ["wide", "square"],
});
