# Native Claude fixture

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
