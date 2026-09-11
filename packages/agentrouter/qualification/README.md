# Native Claude fixture

An additional experimental kernel probe compiles a disposable C helper and
checks a default-deny macOS Seatbelt profile using only synthetic files and a
local endpoint:

```sh
oompa-host-run --mode=shared --lane=mac-native --label=textbutler-kernel-boundary-probe -- bun packages/agentrouter/qualification/macos-sandbox.ts
oompa-host-run --mode=shared --lane=mac-native --label=textbutler-native-claude-os-scope -- bun packages/agentrouter/qualification/claude-native.ts --os-sandbox
```

The second command applies that same experimental profile to the actual native
Claude fixture below. Neither command enables a production adapter or issues a
production qualification. The profile allows only the pinned executable,
specified system libraries and loader paths, private scratch directories, standard
I/O descriptors, and one local TCP port. The helper checks foreign file, directory
and FIFO reads, foreign writes, process creation, other executables and other
network ports. Re-execution of the same pinned binary is permitted by the profile;
fork and other executable paths remain denied. This is an explicit diagnostic
for the current Mac, not a portable sandbox guarantee. Production use also needs
a reviewed provider relay and exact distribution/account admission.

Current result on the tested Darwin 25.5.0 ARM64 host: the converged kernel helper
passes its nine checks. The actual pinned Claude fixture fails before its first
initialization event, with zero model requests and no effective tool inventory.
Consequently there is no native production qualification. A separate bounded
`macos-native-bootstrap.ts` diagnostic was prepared to run only the pinned
executable's `--version`; automatic approval review rejected that invocation due
to a reported usage limit, so it has not executed. Do not treat the helper result
as evidence that the actual native process can run within this profile.

Run the explicit fixture on macOS ARM64 through the installed host scheduler:

```sh
oompa-host-run --mode=shared --lane=mac-native --label=textbutler-native-claude-scope -- bun packages/agentrouter/qualification/claude-native.ts
```

It runs the actual pinned native Claude Code binary through the real Agent SDK,
using a fresh synthetic home, fake API key, local synthetic Anthropic Messages
endpoint and disposable Textbutler contact folders. It does not load a real account
or make paid model calls. It shares the production restricted option builder;
custom endpoints are confined to this fixture.

The scenarios verify zero-tool classification; denied built-in command, file,
agent, skill, network and tool-discovery calls; allowed broker conditional edits
and staged replies; and rejected absolute/traversal/symlink/hardlink reads and
stale or escaping writes. Explicit Skill `doctor` / `checkup` calls must return
errors, and wrapped `/doctor`, `/checkup` and bang commands must reach the synthetic
API as the exact literal task text. Every request must advertise the exact broker
manifest. Poisoned settings, hook, MCP and instruction fixtures
exercise inheritance. A sibling canary and command marker detect effects, and
actual native tool results establish denial independently of absent effects.

A successful JSON receipt records the binary/SDK identity, platform and exact
scenarios. It is **not** a production qualification receipt. Its scope is the
model-visible tool boundary in this synthetic environment. It does not prove an
OS sandbox against a compromised provider executable, exclusion of every managed
system policy, prohibition of process-group escape by trusted helpers, or live
provider/model/account behavior. Do not convert it into `RuntimeQualification`
without reviewing the deployment's remaining requirements and evidence.

The fixture directly uses Textbutler's contact workspace implementation because
that consumer supplies the filesystem enforcement. Agentrouter itself continues
to depend only on its generic file broker port.

The pinned native runtime retains `doctor` in its discovery catalog with only an
empty skills allowlist. The shared production builder also sets the documented
`skillOverrides` for `doctor` and `checkup` to `off`; the native fixture proves those
restrictive settings and keeps the empty catalog assertion intact. The
[SDK skills documentation](https://code.claude.com/docs/en/agent-sdk/skills) explains
why discovery metadata and execution authority are different.
