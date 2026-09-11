import type { ClaudeApiKeyResolver } from "./claude-sdk.ts";
import { identifier } from "./validation.ts";

/**
 * Explicit host-owned account bindings for unattended local use. Only selected
 * environment variables are read, at invocation time. No ambient provider key,
 * personal provider home, subscription token or account discovery is consulted.
 * A desktop Keychain integration can implement the same withApiKey interface.
 */
export function createEnvironmentClaudeApiKeyResolver(
  bindings: Readonly<Record<string, string>>,
  readEnvironment: (name: string) => string | undefined = (name) => process.env[name],
): ClaudeApiKeyResolver {
  const names = new Map<string, string>();
  for (const [accountId, variable] of Object.entries(bindings)) {
    identifier(accountId);
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(variable)) throw new Error("CLAUDE_KEY_BINDING_INVALID");
    names.set(accountId, variable);
  }
  return Object.freeze({
    async withApiKey<T>(accountId: string, signal: AbortSignal, use: (apiKey: string) => Promise<T>): Promise<T> {
      signal.throwIfAborted();
      const name = names.get(identifier(accountId));
      if (name === undefined) throw new Error("CLAUDE_ACCOUNT_NOT_BOUND");
      const value = readEnvironment(name);
      if (typeof value !== "string" || !/^sk-ant-api03-[A-Za-z0-9_-]{16,512}$/u.test(value)) throw new Error("CLAUDE_API_KEY_REQUIRED");
      signal.throwIfAborted();
      return use(value);
    },
  });
}
