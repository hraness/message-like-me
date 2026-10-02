# Local data

TextButler keeps settings, contact memory, reply journals, and setup records in
`~/Library/Application Support/Textbutler`, unless you choose another data
directory. These files are private to the Mac user. xcb and GhostGet keep their
own accounts and credentials in their own state directories, which you
configure separately.

## What TextButler keeps

Media you import through the CLI lives in the selected contact's private
`outbox`. Each file is limited to 16 MiB and counts toward the contact
workspace's 500-file limit. Importing the same bytes with the same extension
again reuses the existing copy. Imports stay after a draft expires so you can
review or reuse them. Erasing the whole installation's data removes these
copies without changing the original files.

iMessage setup keeps one small account binding so that repeating setup can't
quietly authorize a different account under the same name. Failed attempts
don't replace that binding. Setup results contain short progress notes and
digests, never message bodies or credentials.

An app upgrade keeps the previous signed app and its install record under
`~/Applications/.textbutler-app-upgrades`, for up to 32 upgrades. While an
upgrade is in progress, `state/macos-app-upgrade.json` also stays in the data
directory until TextButler confirms the upgrade or its rollback finished. Leave
both locations alone while an upgrade is unresolved.

When habitats are turned on, the run journal also keeps each contact's habitat
state: personality and tool settings, the `soulCore` you wrote, learned
excerpts, reply episodes, follow-up windows, evaluation records, and rollback
history. A reply episode can include up to two tool queries and results
shortened to 4 KiB each, plus the kinds of actions it submitted. Learned memory
holds up to 64 sourced excerpts of 1 KiB each within a 96 KiB encoded total,
with categories, source message IDs, authors, dates, source digests, and
truncation flags. The digests cover the observations learning used. Each episode
keeps at most eight 512-byte excerpts shown while composing the final reply,
plus up to 24 IDs and digests for excerpts that only tool steps exposed.
Clearing learned memory removes the active excerpts and stops older
observations from restoring them; saved episodes, inference records, and
`MEMORY.md` are separate and stay. The JavaScript tool record stores a code
digest, not the source, and a size-limited result.

Habitat state is limited to 512 KiB per contact. The journal keeps the latest 32
replayable inference records per contact, and a global daily table of API
spending reservations with the costs the provider reported. Gateway and other
provider credentials live under `state/provider-credentials`, readable only by
you; they never enter contact workspaces or the journal.

Task-study exports are separate private files that you create and place outside
contact workspaces. They can contain full message context and model output,
within their size limits. Keep captures, annotation files, and complete
evaluation archives out of Git and public reports; their content hashes don't
anonymize them. After a study, you can delete these exports without changing the
original journal. A staged shadow task keeps its evaluated program and examples
in the contact's existing habitat state, plus its archive digest and one
previous version. Keep the matching private evaluation archive for audit.
Rollback keeps the previous artifact and a small rollback marker; it doesn't
erase history or turn a task on for replies.

A separate script handles one old failure: the GhostGet 0.18.16 iMessage startup
crash. It takes a private record of that crash, checks the original crash, app,
connector, account, and process state, then archives a short record of the
outcome before clearing that attempt's setup marker. It never retries setup or
changes accounts, permissions, or messages, and it refuses any other kind of
failure.

## Remove TextButler data

Run `textbutler daemon uninstall` before removing local data, and confirm that
TextButler and its connector operations have stopped. If an operation has an
uncertain outcome, reconcile it first and keep the records needed to do so.

To erase an installation, delete its whole TextButler data directory. This
removes settings, contact memory, journals, setup results, and the iMessage
account binding. It doesn't delete Messages history, GhostGet or xcb accounts,
or macOS permission grants. Deleting individual binding or lock records is not
a supported way to replace an account or retry a failed operation.
Reinstalling the command and uninstalling the background service both keep
data by default.

Once every app upgrade has finished and the installation has stopped, you can
also delete the saved app upgrade folders if you no longer need their rollback
copies. These folders hold app files and upgrade records, never message history
or provider credentials.
