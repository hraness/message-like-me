# Campaigns: paced texts in your own words

`textbutler campaign run` sends texts you wrote to enrolled contacts, one at a
time, at a slow pace. You are the author, so each text goes out exactly as
written, with no `🤖{ }` wrap. Everything the butler composes keeps its
disclosure, and this command never runs a model.

Only use it for words you wrote and would send by hand. If an agent drafted a
message, it goes through `textbutler messages send`, which keeps the wrap.

## The file

Each line of the file is one message:

```json
{"id":"intro-1","contact":"CONTACT_ID","text":"Hey {{first}}, I finally shipped the thing.","vars":{"first":"Sam"},"timeZone":"America/New_York"}
```

- `id` names the message within the campaign. Keep it stable.
- `contact` is a contact ID or an exact, unique contact name. The contact must
  be enrolled for sending and cannot be your own self chat.
- `{{name}}` placeholders are filled from `vars`. A missing value, or any
  brace left after filling (such as a `{name}` typo), stops the run before
  anything is sent.
- `timeZone` is optional. Quiet hours use it, else `--time-zone`, else this
  Mac's zone.

Keep campaign files and their state outside any shared repository; they hold
your contacts' names.

## Running it

```sh
textbutler campaign run /absolute/intro.jsonl --dry-run
textbutler campaign run /absolute/intro.jsonl
textbutler campaign status /absolute/intro.jsonl
```

`--dry-run` prints every rendered message, its recipient, the pacing and a
rough duration, and sends nothing. `wouldRefuse` counts messages the service
would refuse because they contain the butler keyword for a person whose butler
is on; each is marked `"refusal": "butler-keyword"`. Every command prints JSON
lines.

## Pacing

| Setting | Default | Limit |
| --- | --- | --- |
| `--min-interval` | 60s | at least 20s |
| `--jitter` (random extra delay) | 120s | at least 10s |
| `--max-per-hour` | 15 | at most 60 |
| `--max-per-day` | 30 | at most 200 |
| `--burst`, `--burst-pause` | pause 10 to 25 minutes after 6 sends | burst at most 20, pause at least 5m |
| `--recipient-gap` | 24h between two messages to one person | at least 1h |
| `--quiet-hours` | 19:30-10:00 in the recipient's zone | at least 6 hours |

The recipient gap counts any message you or the butler sent that person, so
two campaign files that share people, or a text you typed by hand, never land
closer together than the gap. The run prints `recipient-deferred` and moves on
to other people meanwhile.

The service also enforces the minimum interval between any two of your
campaign texts, across every person and every campaign file. A rerun after a
lost confirmation waits out the interval from that send too.

## Resuming and stopping

Progress lives in `FILE.jsonl.state.json` beside the file, or at `--state`.
Rerun the same command to resume after a crash or a halt. Each message carries
a stable key, and the service records the send under that key before it goes
out, so a rerun never sends the same message twice. Changing the text or
recipient of a message that was already attempted is refused; give it a new
`id` instead.

A recipient is skipped for the rest of the run once they reply, and before a
first message when their last message to you is still unanswered. That is the
moment to answer by hand.

The run halts when:

- a send is not confirmed. Check Messages, record what happened with
  `textbutler replies reconcile CONTACT_ID --sent` or `--failed`, then rerun.
  The message is never sent again automatically.
- a send fails. Repeated failures can mean Messages is filtering the account,
  so the run stops rather than pushing on.
- the service refuses before sending, for example because another reply to
  that person is in flight, or another campaign text went out less than the
  minimum interval ago. Nothing was sent; rerun later.
- a text contains the butler keyword for a person whose butler is on. The
  butler would read that as you calling it and reply straight after. Reword
  the text, or turn the butler off for that person first.
- a conversation cannot be read, so a reply cannot be ruled out.

## What is recorded

Sent messages are recorded with `operator` provenance. They count as your own
words in history and style evidence, end a pending reply like any text you
type, and do not count against the butler's hourly reply limit. The records
that make each key send once are kept for about 400 days, longer than other
runs.
