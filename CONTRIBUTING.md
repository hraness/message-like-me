# Contributing

Issues and focused pull requests are welcome. Describe the behavior that should
change, include a minimal synthetic fixture when one helps, and keep unrelated
cleanup out of the same patch.

Install the pinned toolchain and run the complete gate:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Use Bun 1.3.14. Do not add another package manager or lockfile.

## Protect private data

Never use a real Messages database, message, handle, contact name, group title,
attachment, profile, study or Ensoul packet, private path, or installation key in a test,
snapshot, issue, commit, example, or diagnostic. Build SQLite fixtures from
synthetic conversations whose people and content never existed.

Preserve these boundaries:

- `chat.db` is opened read-only and query-only; ingestion never changes
  Messages or its source files.
- Message data remains local. Do not add networking, telemetry, analytics,
  hosted storage, AI-provider calls, authentication, or synchronization.
- There is no send, react, schedule, or messaging-application operation.
- Ordinary aggregate views omit bodies and private identities. Only explicit
  bounded study, Ensoul source, evaluation, or handoff packets write message
  bodies outside the private database.
- Incoming prose is response context, not evidence of the owner's writing
  style. A contact-subject Ensoul packet may rebase direction only for an exact
  direct AddressBook person scope and must keep owner prose as counterpart
  context.
- Local IDs remain HMAC-derived, and owned data paths remain physical and
  private.

## Tests and contracts

Pair parser, schema, SQL, path, and CLI changes with deterministic examples.
Add property tests for laws such as chronological ordering, session and burst
partitioning, aggregate conservation, reply linkage, canonical JSON, stable
HMAC identity, and idempotent re-ingestion where appropriate. Promote a shrunk
property failure into a named regression.

Keep `--json` stdout machine-readable and send diagnostics to stderr. Bound
database reads, message counts, text bytes, lists, study examples, and profile
fields before expensive work or publication. Parse foreign values from
`unknown` and reject unsupported schema changes instead of guessing.

Product-specific skill changes belong under `skills/message-like-me/`; the
copied standalone Ensoul skill lives under `skills/ensoul/` and must remain a
complete attributed vendored copy rather than a dependency. Keep each
`SKILL.md` focused on routing and shared boundaries, put substantial
mode-specific instructions in linked references, and keep each
`agents/openai.yaml` consistent with its skill. The installer must publish both
skills without leaving a partial pair. Run the complete gate after changing
packaged skill files.

The packed consumer must work from the standalone public repository without a
sibling checkout, private package, ambient Messages database, or network
access.

By contributing, you agree that your contribution is licensed under the MIT
License.
