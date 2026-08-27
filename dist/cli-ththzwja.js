// @bun
// src/canonical-json.ts
import { createHash } from "crypto";
function canonicalJson(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}

export { canonicalJson, sha256, prettyJson };
