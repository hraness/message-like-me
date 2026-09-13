import { BROKER_TOOL_NAMES, type BrokerToolName } from "./broker.ts";
import type { CapabilityDescriptor } from "./capabilities.ts";

/** Descriptions shared by native tool inventories and application profiles.
 * createToolBroker remains the semantic parser and effect authority. */
export function brokerDescriptors(names: readonly BrokerToolName[]): readonly CapabilityDescriptor[] {
  if (new Set(names).size !== names.length || names.some(name => !BROKER_TOOL_NAMES.includes(name))) throw Error("INVALID_TOOL_SET");
  const path = { type: "string", minLength: 1, maxLength: 1024 } as const;
  const id = { type: "string", minLength: 1, maxLength: 160 } as const;
  const fields = {
    "files.read": { path },
    "files.write": { path, text: { type: "string", maxLength: 256 * 1024 }, expectedRevision: { anyOf: [id, { type: "null" }] } },
    "web.fetch": { url: { type: "string", minLength: 1, maxLength: 8192 }, maxBytes: { type: "integer", minimum: 1, maximum: 256 * 1024 } },
    "messages.propose_text": { text: { type: "string", minLength: 1, maxLength: 16 * 1024 }, idempotencyKey: id },
    "messages.propose_reaction": { messageId: id, reaction: { type: "string", enum: ["love", "like", "dislike", "laugh", "emphasize", "question"] }, idempotencyKey: id },
    "messages.propose_attachment": { path, caption: { type: "string", maxLength: 16 * 1024 }, idempotencyKey: id },
  };
  return Object.freeze(names.map(name => Object.freeze({ name,
    description: name === "files.read" ? "Read this contact's relative file and revision."
      : name === "files.write" ? "Conditionally write this contact's relative file; use the read revision, or null for creation."
      : name === "web.fetch" ? "Read bounded public HTTPS text through the host."
      : "Stage this contact's proposed message action; this does not send anything.",
    inputSchema: Object.freeze({ type: "object", properties: fields[name], required: Object.keys(fields[name]), additionalProperties: false }),
  })));
}
