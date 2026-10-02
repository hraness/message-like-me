# TextButler readiness

TextButler works today as a local pilot that you run and supervise yourself.
It is headless: its CLI and guided terminal connect configured messaging
accounts, select direct or group conversations, show the reply inbox, and manage
contacts. You can write a reply, review its complete disclosed text, and send
it. Installing starts no service, connects no account, and turns on no
automatic replies.

It isn't yet an assistant you can leave running unattended. Setup shows the gaps
below, and each needs to be closed before that changes.

| Area | Works now | Still to verify |
| --- | --- | --- |
| First use | Guided terminal, readiness checks that say what to do next, setup that only adds, paused defaults | First-run testing with real accounts and permissions the owner chose |
| Reply review | Complete ordered action review, recipient and context digest, attachment byte check; revision checks on typed previews | Live delivery to an agreed recipient, and owner-takeover tests |
| Agent execution | A verified bundle requires TextButler's reviewed build record; by default Qwen 3.5 Flash writes replies through the owner's Vercel AI Gateway key, or an [external xcb subscription connection](native-subscription.md) does, with a pinned executable, private state, account, and model; no default account and nothing turns on automatically | The exact xcb build passing its provider checks, both classifier and reply checks, and signed-in live inference on the selected account; the Claude API route still needs its own trusted runtime review |
| iMessage | Existing native GhostGet connection | Current account permissions and live transport testing |
| WhatsApp | Existing GhostGet linked-device connection and owner-started sync | Current linked-device identity, sync, and live transport testing |
| Beeper | Direct and group text conversations through GhostGet, using the version the [setup guide](getting-started.md) requires; independent connection checks | Current Desktop API and account setup, reconciling pending sends by message ID, and observing edits and deletions |
| Uncertain sends | The journal keeps the send intent and blocks further sends | Owner reconciliation using the run and message IDs GhostGet keeps; no blind retry |
| Distribution | Local integrity-checked bundle and an installer that starts nothing; the `external-xcb` capability keeps provider execution in a separately configured xcb | A signed public release, tested upgrades, and per-provider checks; artifact hashes say nothing about providers |

## Interface direction

xcb is a useful model for how the terminal should behave: a clear status view,
filtered pickers, choices in context, complete review, and clean cancellation.
TextButler follows the same split, with a thin terminal client over its owner
control protocol. Every permission, account, contact, grant, and send check
stays in the daemon.

TextButler has no menu bar companion or desktop window. If the terminal grows
into a full-screen workspace, xcb's Ratatui and Crossterm interface is a good
reference. The subscription connection uses xcb's dedicated zero-tool
`generate` command. It doesn't use xcb's workspace coding command or inherit
its tools and sessions.

## Agent execution direction

The verified bundle connects to the xcb installation you select, after its
build checks the reviewed record against the current source files and both
contact profiles. A daemon started from source has no built-in approval and
never uses a subscription. xcb handles Claude Code, Codex, or Devin
subscription sign-in, confinement, and account locking. TextButler uses
zero-tool generation, reads one proposed operation at a time, and applies its
contact broker's rules before anything happens.

Accounts stay unavailable until you configure and check them, and contacts stay
off until you turn them on. Setup, the installer, or a matching hash never mark
a provider as ready. The [subscription guide](native-subscription.md) explains
how the connection works and the runtime and live checks it still needs.
TextButler's MIT source is a reference application for xcb; publishing it
doesn't mean it's ready to run unattended.

## Messaging expansion

Use Beeper for linked Signal, Telegram, and Instagram conversations, and keep
native iMessage and WhatsApp. Beeper automation is text-only for now, so
capability labels must not promise attachments, reactions, polls, or delivery
confirmation that its adapter doesn't provide.

A native Telegram client, an owner-linked Signal adapter, and an Instagram
professional-account integration each have different account models and
operating needs. Each should arrive through GhostGet's transport protocol, with
declared capabilities and live test criteria. Business and bot APIs can't
replace a personal inbox. See [messaging app support](messaging-apps.md) for
the primary sources and the limits of each approach.

## Before turning on automatic replies

Verify the exact installed build, model account, messaging identity, and
selected recipient. Test pausing, owner activity while a reply is being written,
cancellation just before sending, losing the transport, restarting during an
uncertain send, and a grant expiring. Passing the simulated test suite shows
the source behaves as designed; it doesn't prove real delivery or that the
native agent is isolated.

Keep records of failed or uncertain account locks. Reinstalling, restarting, or
running setup must not delete them to make an account look ready.
