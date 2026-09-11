import { boundedText, identifier, object, safeInteger } from "./validation.ts";

export interface WorkspaceFiles {
  /** Host must confine resolution by directory handle, reject links, and bound IO. */
  read(workspaceId: string, path: string, signal: AbortSignal): Promise<{ text: string; revision: string }>;
  /** Conditional writes prevent an agent from overwriting a concurrent human edit. */
  write(workspaceId: string, path: string, text: string, expectedRevision: string | null, signal: AbortSignal): Promise<{ revision: string }>;
}
export interface PublicWeb {
  /** Host validates DNS addresses and every redirect; refuses private IPs, credentials and local services. */
  fetchPublic(url: string, maxBytes: number, signal: AbortSignal): Promise<{ text: string; url: string }>;
}
export interface ScopedMessaging {
  /** Stages an intent only. The host owns later disclosure, enrollment, journaling and dispatch. */
  stage(workspaceId: string, runId: string, operation: MessageOperation, signal: AbortSignal): Promise<{ intentId: string }>;
}
export type MessageOperation =
  | Readonly<{ kind: "text"; text: string; idempotencyKey: string }>
  | Readonly<{ kind: "reaction"; messageId: string; reaction: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question"; idempotencyKey: string }>
  | Readonly<{ kind: "attachment"; path: string; caption: string; idempotencyKey: string }>;

export const BROKER_TOOL_NAMES = ["files.read", "files.write", "web.fetch", "messages.propose_text", "messages.propose_reaction", "messages.propose_attachment"] as const;
export type BrokerToolName = typeof BROKER_TOOL_NAMES[number];
export interface ToolBroker {
  readonly workspaceId: string;
  readonly runId: string;
  readonly tools: readonly BrokerToolName[];
  invoke(name: unknown, input: unknown): Promise<unknown>;
  revoke(): void;
}

/** One capability-bound broker per run. Input never selects another workspace or recipient. */
export function createToolBroker(options: {
  workspaceId: string;
  runId: string;
  files: WorkspaceFiles;
  web: PublicWeb;
  messaging: ScopedMessaging;
  isActive: () => boolean;
  signal?: AbortSignal;
  allowedTools?: readonly BrokerToolName[];
}): ToolBroker {
  const workspaceId = identifier(options.workspaceId), runId = identifier(options.runId);
  const controller = new AbortController();
  const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
  const names = Object.freeze([...(options.allowedTools ?? BROKER_TOOL_NAMES)]);
  if (new Set(names).size !== names.length || names.some((name) => !BROKER_TOOL_NAMES.includes(name))) throw new Error("INVALID_TOOL_SET");
  const assertActive = () => {
    signal.throwIfAborted();
    if (!options.isActive()) throw new Error("RUN_REVOKED");
  };
  // Serialize broker calls so contact edits and outbound effects have a single order.
  let tail = Promise.resolve<unknown>(undefined);
  const dispatch = async (name: unknown, raw: unknown): Promise<unknown> => {
    assertActive();
    if (typeof name !== "string" || !names.includes(name as BrokerToolName)) throw new Error("TOOL_DENIED");
    switch (name) {
      case "files.read": {
        const input = object(raw, ["path"]);
        const result = await options.files.read(workspaceId, relativeFile(input.path), signal);
        assertActive();
        return { text: boundedText(result.text, 256 * 1024, true), revision: boundedText(result.revision, 160) };
      }
      case "files.write": {
        const input = object(raw, ["path", "text", "expectedRevision"]);
        const expected = input.expectedRevision === null ? null : boundedText(input.expectedRevision, 160);
        const result = await options.files.write(workspaceId, relativeFile(input.path), boundedText(input.text, 256 * 1024, true), expected, signal);
        assertActive();
        return { revision: boundedText(result.revision, 160) };
      }
      case "web.fetch": {
        const input = object(raw, ["url", "maxBytes"]);
        const url = publicHttpsUrl(input.url);
        const maxBytes = input.maxBytes === undefined ? 64 * 1024 : safeInteger(input.maxBytes, 1, 256 * 1024);
        const result = await options.web.fetchPublic(url, maxBytes, signal);
        assertActive();
        return { text: boundedText(result.text, maxBytes, true), url: publicHttpsUrl(result.url) };
      }
      case "messages.propose_text": {
        const input = object(raw, ["text", "idempotencyKey"]);
        return stage({ kind: "text", text: boundedText(input.text, 16 * 1024), idempotencyKey: identifier(input.idempotencyKey) });
      }
      case "messages.propose_reaction": {
        const input = object(raw, ["messageId", "reaction", "idempotencyKey"]);
        const reactions = ["love", "like", "dislike", "laugh", "emphasize", "question"] as const;
        if (!reactions.includes(input.reaction as typeof reactions[number])) throw new Error("UNSUPPORTED_REACTION");
        return stage({ kind: "reaction", messageId: identifier(input.messageId), reaction: input.reaction as typeof reactions[number], idempotencyKey: identifier(input.idempotencyKey) });
      }
      case "messages.propose_attachment": {
        const input = object(raw, ["path", "caption", "idempotencyKey"]);
        return stage({ kind: "attachment", path: relativeFile(input.path), caption: boundedText(input.caption, 16 * 1024, true), idempotencyKey: identifier(input.idempotencyKey) });
      }
      default: throw new Error("TOOL_DENIED");
    }
  };
  const stage = async (operation: MessageOperation) => {
    assertActive();
    const staged = await options.messaging.stage(workspaceId, runId, Object.freeze(operation), signal);
    // Staging grants no send authority. The application rechecks policy before dispatch.
    return { intentId: identifier(staged.intentId) };
  };
  return Object.freeze({
    workspaceId,
    runId,
    tools: names,
    revoke: () => controller.abort(new Error("RUN_REVOKED")),
    invoke(name: unknown, input: unknown) {
      // Capture the parsed provider frame before waiting behind another effect.
      // The host must not be able to mutate an already-enqueued request by alias.
      let snapshot: unknown;
      try {
        const encoded = JSON.stringify(input);
        if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 512 * 1024) throw new Error("TOOL_INPUT_TOO_LARGE");
        snapshot = JSON.parse(encoded) as unknown;
      } catch {
        return Promise.reject(new Error("INVALID_TOOL_INPUT"));
      }
      const result = tail.then(() => dispatch(name, snapshot));
      tail = result.catch(() => undefined);
      return result;
    },
  });
}

export function relativeFile(value: unknown): string {
  const path = boundedText(value, 1024);
  const parts = path.split("/");
  if (parts.length > 8 || path.includes("\\") || parts.some((part) => !/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,127}$/u.test(part)
    || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" "))) throw new Error("PATH_OUTSIDE_WORKSPACE");
  return path;
}

/** First-pass URL syntax guard; the host transport must also enforce DNS and redirects. */
export function publicHttpsUrl(value: unknown): string {
  const url = new URL(boundedText(value, 8192));
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash
    || !hostname.includes(".") || hostname.endsWith(".") || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || /^[\d.]+$/u.test(hostname) || hostname.startsWith("[")) throw new Error("PUBLIC_HTTPS_REQUIRED");
  return url.href;
}
