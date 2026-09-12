# Contents

- `src/` owns provider-neutral routing, account leases, model selection and scoped tool contracts.
- `test/` contains synthetic boundary and concurrency tests.
- `README.md` records integration requirements and current qualification limits.

# Guidelines

- Keep account credentials and provider runtime state outside consumer workspaces. Resolve authentication through a trusted host adapter.
- Never equate a prompt, cwd, tool list or expired lease with OS isolation or proof that a process stopped.
- Admit a provider only after the host proves the exact runtime, effective tool inventory, configuration isolation and read/write confinement. Unqualified adapters remain disabled.
- Keep broker inputs closed and bounded; applications own filesystem custody and messaging authorization.
- Preserve exclusive account custody after uncertain provider failures. Require independent process-exit evidence before recovery.
