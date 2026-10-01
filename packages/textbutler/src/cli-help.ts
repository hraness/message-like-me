import { supportAdvancedHelp, supportHelpLine } from "@hraness/support-foundation/node";
import { CAMPAIGN_HELP } from "./campaign.ts";
import { TEXTBUTLER_VERSION } from "./version.ts";

/** UTF-8 pins the shared support copy the way the rest of static help reads. */
const HELP_ENV = { LANG: "en_US.UTF-8" } as const;

/** Registry one-line description (portfolio registry, packages/textbutler/package.json). */
export const TEXTBUTLER_DESCRIPTION = "TextButler puts a clearly marked AI assistant in the iMessage, WhatsApp, and\nBeeper chats you choose on your Mac, and it answers when someone says \u201cbutler\u201d.";

/** Bare invocation without a terminal: at most 25 lines (SPEC § D2). */
export const BARE_INTRO = `${TEXTBUTLER_DESCRIPTION}
New installs start paused, and everyone starts off.

Start here
  textbutler setup           Create private settings, paused
  textbutler tui             Connect apps and choose chats, step by step
  textbutler doctor          See what's ready and what to do next

Everyday
  textbutler status          See what TextButler is doing
  textbutler inbox           Find chats waiting for your reply
  textbutler pause           Pause automatic replies

All commands: textbutler --help · Topics: textbutler help <topic>
textbutler ${TEXTBUTLER_VERSION}`;

/** Root help: at most 60 lines, grouped; advanced verbs live in help advanced. */
export const ROOT_HELP = `${TEXTBUTLER_DESCRIPTION}

Usage: textbutler <command> [options]

Start here
  setup                      Create private settings; replies start paused
  tui                        Guided terminal: connect apps, choose chats
  doctor                     Check what's ready and what to do next

Everyday
  status                     Show what the background service is doing
  pause | resume             Pause or resume automatic replies
  inbox                      Find chats waiting for your reply
  replies <command>          Suggest, review and send replies

Chats and contacts
  conversations list         List recent chats you can add
  contacts <command>         Add chats and choose how TextButler answers
  messaging list | start     Show or connect iMessage, WhatsApp or Beeper

AI replies
  providers gateway-key      Save a Vercel AI Gateway key (replies use Qwen)
  providers local            Reply with a model on your own local server
  providers list             Show connected AI accounts
  providers check <account>  Check that one account is ready

Decisions and the service
  approvals list | show      Review suggestions; decide needs you in person
  permissions list | set     See or change which chats get automatic replies
  control serve | stop       Run the service here, or ask it to exit
  control install            Start the service at login (you run this)
  commands --json            List every command and who may run it

Options
  -h, --help                 Show help (also: textbutler help <topic>)
  -V, --version              Show the version
  --json                     Print machine-readable output
  --data-dir <path>          Use another private data folder (absolute path)

Topics: setup, contacts, replies, messaging, providers, daemon, control,
approvals, permissions, advanced. Add --json to any command for agents.

${supportHelpLine({ command: ["textbutler"], env: HELP_ENV })}`;

interface Topic { usage: string; summary: string; body?: string; example?: string }

/** Per-command help. Every entry fits in 80 columns and glosses its terms. */
const TOPICS: Record<string, Topic> = {
  setup: { usage: "textbutler setup [options]",
    summary: "Create your private settings, or add a messaging app or AI account.\nAutomatic replies start paused. Setup never reads or sends messages.",
    body: `Options
  --ghostget <path>          GhostGet executable that connects your apps
  --runtime <path>           Bun, when GhostGet is a .ts file
  --state-home <path>        GhostGet's private state folder
  --account <app>:<id>       Account to use, e.g. imessage:messages (repeat)
  --xcb <path>               xcb executable for your AI subscription
  --xcb-state <path>         xcb's private state folder
  --xcb-account <ai>:<id>    Signed-in xcb account: claude, codex or devin
  --xcb-model <ai>/<model>[/<effort>]
                             Model for that account

Use absolute paths. Sign in with GhostGet and xcb first; TextButler stores
only references and pins the xcb file's checksum. Stop the service before
adding a connection, then start it again.`,
    example: "textbutler setup --ghostget /opt/ghostget/ghostget --account imessage:messages" },
  tui: { usage: "textbutler tui [--snapshot | --json] [--width <n>]", summary: "Open the guided terminal. It walks through setup, connecting apps,\nadding chats and reviewing replies. Quitting leaves the service running.\n--snapshot prints every view as plain text; --json prints the same data\nas textbutler status --json. Neither needs a terminal." },
  doctor: { usage: "textbutler doctor [--json]", summary: "Check each setup step and show the one thing to do next.\nDoctor only reads local settings; it never reads messages or spends credits.",
    body: `Options
  --json                     Print the full readiness report as JSON` },
  status: { usage: "textbutler status [--json]", summary: "Show the service, chats, suggestions and AI accounts." },
  pause: { usage: "textbutler pause", summary: "Pause automatic replies for every chat. Replies you send yourself still work." },
  resume: { usage: "textbutler resume", summary: "Resume automatic replies. Chats that are off stay off." },
  inbox: { usage: "textbutler inbox", summary: "Check the chats you added and list the ones waiting for your reply." },
  replies: { usage: "textbutler replies <command>", summary: "Suggest, review and send replies. Nothing is sent until you run send.",
    body: `Commands
  replies suggest <contact>          Write a suggestion without sending it
  replies show <draft>               Show every action in a suggestion
  replies send <draft> <check>       Send exactly what you reviewed; <check>
                                     is the digest that replies show prints
  replies send <contact> <text...>   Send your own reply
  replies discard <draft>            Throw a suggestion away
  replies reconcile <contact> [--sent | --failed]
                                     Record whether an uncertain send arrived

A contact is an exact ID or a unique name from textbutler contacts list.`,
    example: "textbutler replies suggest Alex" },
  contacts: { usage: "textbutler contacts <command>", summary: "Choose which chats TextButler answers and how. New chats start off.",
    body: `Commands
  contacts list                          Show chats and their settings
  contacts add <candidate> [--history]   Add a chat from conversations list;
                                         --history imports recent messages
  contacts enable <contact>              Turn on automatic replies
  contacts disable <contact>             Turn them off and remove send access
  contacts account <contact> <account>   Choose the AI account for a chat
  contacts mode <contact> smart|keyword [--keyword <word>]
                                         Answer everything, or only when a
                                         message includes the keyword
  contacts self <contact> on|off         Mark a chat with yourself, so your
                                         own echoed texts aren't answered
  contacts label <contact> <name>        Rename a chat, so commands read a name
                                         instead of a raw number

Choosing an account never turns a chat on, and resume never does either.`,
    example: "textbutler contacts mode Alex keyword --keyword butler" },
  conversations: { usage: "textbutler conversations list", summary: "List recent chats from your connected apps. Add one with\ntextbutler contacts add <candidate>. The list expires after five minutes." },
  messaging: { usage: "textbutler messaging list | start <app>", summary: "Show configured messaging apps, or connect one: imessage, whatsapp\nor beeper. Sign in to each app with GhostGet first. iMessage also\nneeds macOS access for TextButler: see textbutler help permissions.",
    example: "textbutler messaging start imessage" },
  providers: { usage: "textbutler providers gateway-key | local | list | check <account>", summary: "Set up AI replies, show your AI accounts, or check that one is ready.",
    body: `Commands
  providers gateway-key      Save a Vercel AI Gateway key from a pipe
  providers local [model]    Reply through a local server instead
                             (--base-url http://127.0.0.1:<port>/v1)
  providers list             Show connected AI accounts
  providers check <account>  Check that one account is signed in and ready

Replies can be written by a local model through Ollama (in testing), by Qwen
3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex,
or Devin subscription through xcb.

A command choice wins. Otherwise a saved gateway key (capped at $1 a day) wins
over a local model. Pipe the key in so it never lands in your shell history,
then restart the background service. providers local switches replies to an
OpenAI-compatible server on this Mac (Ollama by default; pull
qwen3:4b-instruct-2507-q4_K_M first); stop the service first. Subscription
accounts (native-claude-code, native-codex and native-devin) connect through
xcb. A saved gateway key still powers web search.`,
    example: "pbpaste | textbutler providers gateway-key" },
  daemon: { usage: "textbutler daemon install | uninstall | status | run", summary: "Manage the background service that watches your chats.",
    body: `Commands
  daemon install             Start it now and at login
  daemon uninstall           Stop it and remove it from login
  daemon status              Show whether it's running
  daemon run                 Run it in this terminal instead

Install and uninstall ask you to type a one-time code shown in your own
terminal, like control install. macOS shows a "Background Items Added"
notice when you install it.` },
  support: { usage: "textbutler support", summary: "See optional ways to support TextButler. Turn off: HRANESS_SUPPORT=off." },
  init: { usage: "textbutler init", summary: "Create private settings, paused, without the readiness checklist." },
  jobs: { usage: "textbutler jobs show <job>", summary: "Read the result of a long operation that was still running. Don't repeat\nthe original command: it may already have happened." },
  habitats: { usage: "textbutler habitats <command>", summary: "A habitat is a chat's reply style, memory and daily budget.",
    body: `Commands
  habitats show <contact>                     Show it as JSON
  habitats configure <contact> <rev> <json>   Replace it (replies paused)
  habitats rollback <contact> <rev>           Go back to revision <rev>
  habitats memory-clear <contact> <rev>       Forget learned excerpts
  habitats task-stage <contact> <rev> <file>  Stage shadow task (paused)
  habitats task-rollback <contact> <rev>      Roll back shadow task (paused)

<rev> is the revision that habitats show prints.` },
  messages: { usage: "textbutler messages <command>", summary: "JSON commands for agents that read and draft in one chat.",
    body: `Commands
  messages history <contact> [--limit 1..200]
  messages summarize <contact> [--limit 1..200]
  messages capabilities <contact>
  messages compose <contact> --text <text>
  messages compose <contact> --actions <absolute path to actions.json>
  messages react <contact> <message> <emoji> [--remove]
  messages attach <contact> <absolute path> [--caption <text>]
  messages send <contact> --text <text>

Compose, react and attach create drafts; send one with replies send.
See docs/textbutler/agent-cli.md.` },
  campaign: { usage: "textbutler campaign run | status <file.jsonl> [options]", summary: CAMPAIGN_HELP.split("\n")[0]!.replace(/ \(JSON output\):$/u, "."),
    body: CAMPAIGN_HELP.split("\n").slice(1).join("\n").trimEnd(),
    example: "textbutler campaign run ~/launch/intro.jsonl --dry-run" },
  control: { usage: "textbutler control serve | status | stop | install | uninstall", summary: "Run and stop the background service. It starts only when you ask.",
    body: `Commands
  control serve              Run the service in this terminal
  control status             Show whether it's running and starts at login
  control stop               Ask it to finish and exit (never a signal)
  control install            Start it at login; you run this yourself
  control uninstall          Stop it and remove it from login

install and uninstall change what runs at login, so an agent can't run
them. From your own terminal, they ask you to type a short code first.`,
    example: "textbutler control status --json" },
  approvals: { usage: "textbutler approvals list | show <id> | decide <id> --digest <d> <v>",
    summary: "Review the reply suggestions waiting for you, then send or discard one.",
    body: `Commands
  approvals list             Suggestions waiting for a decision
  approvals show <id>        Every action in one, and its digest
  approvals decide <id> ...  <v> is allow-once (send it exactly as
                             shown) or deny (discard it)

decide needs you in person: an agent gets human-required and nothing
changes. The digest makes sure you send what you reviewed. replies send
still works as before.`,
    example: "textbutler approvals show draft-1" },
  permissions: { usage: "textbutler help permissions", summary: "iMessage works through the TextButler app on this Mac, and macOS needs\ntwo settings for it. TextButler never changes them for you.",
    body: `Full Disk Access: read your Messages
  macOS doesn't ask for this. Turn on Textbutler in System Settings ›
  Privacy & Security › Full Disk Access. Only the chats you pick are read.

Automation: send replies through Messages
  macOS asks once, during app setup. TextButler only sends replies in chats
  you turn on. If you said no, turn on Textbutler in System Settings ›
  Privacy & Security › Automation, then run app setup again.

Install the app and run app setup from a source checkout: see "Give
iMessage access" in docs/textbutler/getting-started.md. Then run
textbutler doctor to check both.

Which chats get automatic replies
  permissions list           Each chat and whether it's on
  permissions set <chat> --expected-revision <n> <loosen|tighten>
                             Turn one chat on (you, in person) or off` },
  advanced: { usage: "textbutler <command>", summary: "Commands for agents and for fixing unusual states.",
    body: `Commands
  init                       Create private settings without the checklist
  jobs show <job>            Read the result of a long operation
  habitats <command>         A chat's reply style, memory and budget
  messages <command>         JSON commands for agents (help messages)
  campaign run <file>        Send your own texts at a slow pace (help campaign)
  daemon run                 Run the service in this terminal
  support                    Optional ways to support TextButler

${supportAdvancedHelp({ command: ["textbutler"], env: HELP_ENV })}` },
};
TOPICS.suggest = TOPICS.replies!;
TOPICS.version = { usage: "textbutler --version", summary: "Show the version." };
TOPICS.help = { usage: "textbutler help [<topic>]", summary: "Show help for a command or topic." };

export const HELP_TOPICS: readonly string[] = Object.keys(TOPICS);

export function topicHelp(name: string): string | undefined {
  const topic = Object.hasOwn(TOPICS, name) ? TOPICS[name] : undefined;
  if (!topic) return undefined;
  return [`Usage: ${topic.usage}`, "", topic.summary, ...(topic.body ? ["", topic.body] : []), ...(topic.example ? ["", "Example", `  ${topic.example}`] : [])].join("\n");
}

/** The known command words, for "did you mean" and help routing. */
export const COMMANDS: readonly string[] = ["setup", "tui", "doctor", "status", "commands", "control", "approvals", "permissions", "pause", "resume", "inbox", "replies", "contacts", "conversations",
  "messaging", "providers", "daemon", "support", "init", "jobs", "habitats", "messages", "campaign", "help", "version"];
