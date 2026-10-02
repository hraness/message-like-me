# Messaging apps

TextButler connects to iMessage and WhatsApp natively through GhostGet, or to
several messaging apps at once through Beeper. If you use iMessage, WhatsApp,
Signal, Telegram, and Instagram on one Mac, Beeper is the simplest single
connection. Each conversation still has to be added with its own reply
settings, and connecting an app never turns on automatic replies by itself.

## Direct and group conversations

Select a direct chat or group in iMessage, WhatsApp, or Beeper. Group setup
requires a complete member list and keeps notes separate from direct chats.
Context begins with new messages after enrollment. A change to the account or
group membership stops replies until you select the group again.

## Choose a connection

| App | Current route | Other options |
| --- | --- | --- |
| iMessage | GhostGet's native Mac connection, or Beeper on that Mac | Keep the native connection for users who do not use Beeper. Apple's Messages framework creates iOS conversation extensions; it is not a Mac inbox API. |
| WhatsApp | GhostGet's reviewed linked-device connection, or Beeper | The official WhatsApp Business Platform is a separate business integration, not a connection to an ordinary personal inbox. |
| Signal | Beeper | A future `signal-cli` connection is possible, but it is unofficial and would need its own maintenance and testing. |
| Telegram | Beeper, subject to the content-use limits below | Telegram's official TDLib supports personal client sessions. A direct connector is a future option, not currently implemented in TextButler. |
| Instagram | Beeper | Meta's official messaging API supports professional accounts. It does not cover the same personal-inbox use case. |

Beeper documents support for these networks, with iMessage limited to macOS.
Its Desktop API runs locally while Beeper Desktop is open. Beeper recommends
on-device connections for this API; initial history can be incomplete.
See [Beeper's Desktop API overview](https://developers.beeper.com/desktop-api/)
and [connection types](https://help.beeper.com/chat-networks/using-on-device-chat-network-connections-in-beeper).
Beeper labels the API a [public beta](https://www.beeper.com/desktop-api).
Apple describes its [Messages framework](https://developer.apple.com/documentation/messages/)
as a way to create sticker packs and iOS conversation extensions.

## Connect Beeper

1. Install Beeper Desktop and connect the messaging accounts you want to use.
   Prefer on-device connections when using this Mac as your messaging host.
2. Enable Beeper's local API. Its current authentication guide places approved
   connections under **Settings → Integrations**; some releases use
   **Settings → Developers**. Authorize GhostGet using its supported Beeper
   account setup. Keep credentials out of contact folders.
3. Use a GhostGet release that includes Beeper owner automation, which first
   appeared in GhostGet's 0.18.14 source. It requires the reviewed Beeper
   adapter and pinned Beeper CLI; an older read-only export setup won't work.
4. Allow GhostGet's Beeper automation read and text-send operations for that
   account. Then select its account ID in TextButler setup.
5. Add a single conversation, check its identity, and start with a reply you
   review yourself. Turn on automatic replies separately, after the connection
   and the selected agent account pass their checks.

Through GhostGet's current automation route, TextButler can send text through
Beeper and read recent conversation history. Beeper's wider API also offers
attachments and other actions, but TextButler doesn't use them yet. Beeper
Desktop must stay open. After a restart or reconnect, TextButler finishes
catching up before new messages can trigger a reply.
See the [GhostGet owner contract](ghostget-contract.md) and
[Beeper authentication](https://developers.beeper.com/desktop-api/auth/).

iMessage in Beeper requires the Mac's Messages data, Automation, Accessibility
and Contacts permissions. Beeper may briefly bring Messages into view. That
connection remains on the Mac where it was configured.
See [Beeper's iMessage setup guide](https://help.beeper.com/en_US/chat-networks/new-imessage-on-macos-getting-started-guide).

## What “sent” means

Beeper returns a pending message ID when it accepts a send request. That isn't
proof of delivery. A later message read can resolve the ID, and delivery status
is available only when the network reports it. TextButler keeps an uncertain
result as uncertain and never sends the message again.
See [Beeper's send contract](https://developers.beeper.com/desktop-api-reference/resources/messages/methods/send/).

The optional Beeper WebSocket stream is experimental. Its sequence numbers
apply to one connection, so they can't mark a resume point across restarts. A
production connector would need to read what it missed after reconnecting.
GhostGet currently keeps TextButler's durable record of new messages.
See [Beeper's event stream](https://developers.beeper.com/desktop-api/websocket-experimental/).

## Options without Beeper

**iMessage and WhatsApp:** The next step is improving the existing GhostGet
setup and recovery. Text and files on iMessage should work with ordinary Mac
permissions; advanced native actions need separately configured support.
The current WhatsApp connection uses a reviewed private build of
[wacli](https://github.com/openclaw/wacli), an unofficial linked-device client.
Its pairing and update requirements are part of the integration.

**Telegram:** TDLib is the strongest documented route to a direct personal
client. It supplies login state changes, local storage, `getChatHistory`, and
`sendMessage`. A shipped client needs its own application ID and hash, a user
login flow, and protected local session storage.
See [Telegram's TDLib guide](https://core.telegram.org/tdlib/getting-started)
and [application registration](https://core.telegram.org/api/obtaining_api_id).

Telegram's current terms restrict using platform content with AI. The content
license describes exceptions only when all relevant users provide explicit,
informed, affirmative and continued consent for the specific content and chat
context. A Beeper connection does not remove that restriction. Do not treat
owner login alone as authorization for unrestricted Telegram AI processing;
resolve the applicable consent requirements before enabling that workflow.
See [Telegram's API terms](https://core.telegram.org/api/terms) and
[content license](https://telegram.org/tos/content-licensing).

**Signal:** A future GhostGet adapter could link `signal-cli` to an existing
account, receive messages through its daemon, and submit exact recipient-bound
sends. The project explicitly calls itself unofficial and warns that versions
older than three months may stop working. It would add a linked device and
ongoing maintenance, and it is not an official Signal integration.
See [the signal-cli project](https://github.com/AsamK/signal-cli).

**WhatsApp Business and Instagram professional accounts:** These are viable
future business connectors with their own setup. WhatsApp uses a business
account, registered business number, access tokens and webhook subscriptions.
Instagram requires a professional account and messaging permission; its Send
API generally replies after a person initiates contact and does not support
group messaging. Neither route should be offered as a replacement for a
personal inbox. See Meta's [WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
and [Instagram Send API](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api).

For personal Instagram, Beeper remains the supported connection. Don't add a
separate private-API or browser-session connector until it has a maintained
provider interface and reliable account recovery.

These recommendations reflect documentation checked on September 19, 2026.
Tests with simulated accounts cover parsing, permissions, and recovery. A live
check still needs the intended account, one specific recipient, and a message
the owner approved, and it must test reconnecting and uncertain sends as well
as the first successful request.
