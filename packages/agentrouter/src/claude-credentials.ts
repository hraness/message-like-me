import type { ClaudeApiKeyResolver } from "./claude-sdk.ts";
import { identifier } from "./validation.ts";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

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

/** Explicit owner-selected files, never contact configuration or provider-home discovery. */
export function createFileClaudeApiKeyResolver(options: Readonly<{
  directory: string;
  bindings: Readonly<Record<string, string>>;
}>): ClaudeApiKeyResolver {
  const directory = options.directory;
  if (!isAbsolute(directory) || resolve(directory) !== directory || /[\u0000-\u001f\u007f]/u.test(directory)) throw new Error("CLAUDE_KEY_DIRECTORY_INVALID");
  const names = new Map<string, string>();
  for (const [accountId, name] of Object.entries(options.bindings)) {
    identifier(accountId);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(name)) throw new Error("CLAUDE_KEY_BINDING_INVALID");
    names.set(accountId, name);
  }
  return Object.freeze({
    async withApiKey<T>(accountId: string, signal: AbortSignal, use: (apiKey: string) => Promise<T>): Promise<T> {
      signal.throwIfAborted();
      const name = names.get(identifier(accountId));
      if (!name) throw new Error("CLAUDE_ACCOUNT_NOT_BOUND");
      let value: string;
      const bytes = Buffer.alloc(1025);
      try {
        const root = await lstat(directory);
        if (await realpath(directory) !== directory || !root.isDirectory() || root.isSymbolicLink()
          || root.uid !== process.getuid?.() || (root.mode & 0o077) !== 0) throw new Error();
        const path = join(directory, name);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.uid !== process.getuid?.() || before.nlink !== 1 || (before.mode & 0o177) !== 0 || before.size > 1024) throw new Error();
          let size = 0;
          while (size < bytes.length) {
            const result = await handle.read(bytes, size, bytes.length - size, size);
            if (!result.bytesRead) break;
            size += result.bytesRead;
          }
          const after = await handle.stat(), current = await lstat(path), currentRoot = await lstat(directory);
          if (size !== before.size || size > 1024 || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
            || currentRoot.dev !== root.dev || currentRoot.ino !== root.ino || currentRoot.mode !== root.mode || currentRoot.uid !== root.uid
            || after.nlink !== 1 || after.mode !== before.mode || after.uid !== before.uid || after.size !== before.size
            || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error();
          value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)).replace(/\r?\n$/u, "");
          if (!/^sk-ant-api03-[A-Za-z0-9_-]{16,512}$/u.test(value)) throw new Error();
        } finally { await handle.close(); }
      } catch { throw new Error("CLAUDE_KEY_FILE_UNAVAILABLE"); }
      finally { bytes.fill(0); }
      signal.throwIfAborted();
      return use(value);
    },
  });
}
