const MAX_SAFE_INTEGER = 9_007_199_254_740_991n;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

export class ArchiveError extends Error {
  override readonly name = "ArchiveError";
}

export class PacketValidationError extends Error {
  override readonly name = "PacketValidationError";
}

export function failPacket(path: string, message: string): never {
  throw new PacketValidationError(`${path}: ${message}`);
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function unsupportedType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "function") return "function";
  return typeof value;
}

function encodeCanonical(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ArchiveError("floating-point values are not supported in source packets");
    }
    if (!Number.isSafeInteger(value)) {
      throw new ArchiveError("integer exceeds the interoperable JSON range");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") {
    if (containsUnpairedSurrogate(value)) {
      throw new ArchiveError("unpaired Unicode surrogate in source packet");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const encoded: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      encoded.push(encodeCanonical(value[index]));
    }
    return `[${encoded.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ArchiveError(`unsupported source packet value: ${unsupportedType(value)}`);
    }
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length !== 0) {
      throw new ArchiveError("source packet object keys must be strings");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${encodeCanonical(key)}:${encodeCanonical(record[key])}`)
      .join(",")}}`;
  }
  throw new ArchiveError(`unsupported source packet value: ${unsupportedType(value)}`);
}

/** Encode Ensoul's integer-only JSON subset using RFC 8785 key ordering. */
export function canonicalText(value: unknown): string {
  return encodeCanonical(value);
}

/** Encode Ensoul's integer-only JSON subset using RFC 8785 JCS. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalText(value));
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function rejectNonIJson(value: unknown, path = "packet"): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      failPacket(path, "floating-point values are not allowed by this packet schema");
    }
    if (!Number.isSafeInteger(value)) {
      failPacket(path, "integer exceeds the interoperable JSON range");
    }
    return;
  }
  if (typeof value === "string") {
    if (containsUnpairedSurrogate(value)) {
      failPacket(path, "contains an unpaired Unicode surrogate");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((member, index) => rejectNonIJson(member, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      failPacket(path, "contains a non-JSON value");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      failPacket(`${path}.key`, "contains a non-JSON value");
    }
    for (const [key, member] of Object.entries(value)) {
      rejectNonIJson(key, `${path}.key`);
      rejectNonIJson(member, `${path}.${key}`);
    }
    return;
  }
  failPacket(path, "contains a non-JSON value");
}

class JsonSyntaxError extends Error {}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) throw new JsonSyntaxError();
    return value;
  }

  private parseValue(): JsonValue {
    const character = this.text[this.index];
    if (character === '"') return this.parseString();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    if (
      this.text.startsWith("NaN", this.index) ||
      this.text.startsWith("Infinity", this.index) ||
      this.text.startsWith("-Infinity", this.index)
    ) {
      failPacket("packet", "contains a non-finite number");
    }
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      return this.parseNumber();
    }
    throw new JsonSyntaxError();
  }

  private parseString(): string {
    this.index += 1;
    let value = "";
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      const character = this.text[this.index]!;
      if (character === '"') {
        this.index += 1;
        return value;
      }
      if (code < 0x20) throw new JsonSyntaxError();
      if (character !== "\\") {
        value += character;
        this.index += 1;
        continue;
      }
      this.index += 1;
      const escape = this.text[this.index];
      if (escape === undefined) throw new JsonSyntaxError();
      if (escape === "u") {
        const digits = this.text.slice(this.index + 1, this.index + 5);
        if (digits.length !== 4 || !/^[0-9a-fA-F]{4}$/u.test(digits)) {
          throw new JsonSyntaxError();
        }
        value += String.fromCharCode(Number.parseInt(digits, 16));
        this.index += 5;
      } else if (escape === '"' || escape === "\\" || escape === "/") {
        value += escape;
        this.index += 1;
      } else if (escape === "b") {
        value += "\b";
        this.index += 1;
      } else if (escape === "f") {
        value += "\f";
        this.index += 1;
      } else if (escape === "n") {
        value += "\n";
        this.index += 1;
      } else if (escape === "r") {
        value += "\r";
        this.index += 1;
      } else if (escape === "t") {
        value += "\t";
        this.index += 1;
      } else {
        throw new JsonSyntaxError();
      }
    }
    throw new JsonSyntaxError();
  }

  private parseObject(): { [key: string]: JsonValue } {
    this.index += 1;
    this.skipWhitespace();
    const value: { [key: string]: JsonValue } = Object.create(null) as {
      [key: string]: JsonValue;
    };
    const keys = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (true) {
      if (this.text[this.index] !== '"') throw new JsonSyntaxError();
      const key = this.parseString();
      if (keys.has(key)) failPacket("packet", "contains a duplicate object member");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") throw new JsonSyntaxError();
      this.index += 1;
      this.skipWhitespace();
      value[key] = this.parseValue();
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return value;
      }
      if (delimiter !== ",") throw new JsonSyntaxError();
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(): JsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const value: JsonValue[] = [];
    if (this.text[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (true) {
      value.push(this.parseValue());
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return value;
      }
      if (delimiter !== ",") throw new JsonSyntaxError();
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.text[this.index] === "-") this.index += 1;
    if (this.text[this.index] === "0") {
      this.index += 1;
      const next = this.text[this.index];
      if (next !== undefined && next >= "0" && next <= "9") throw new JsonSyntaxError();
    } else {
      const first = this.text[this.index];
      if (first === undefined || first < "1" || first > "9") throw new JsonSyntaxError();
      while (this.isDigit(this.text[this.index])) this.index += 1;
    }

    let floatingPoint = false;
    if (this.text[this.index] === ".") {
      floatingPoint = true;
      this.index += 1;
      if (!this.isDigit(this.text[this.index])) throw new JsonSyntaxError();
      while (this.isDigit(this.text[this.index])) this.index += 1;
    }
    const exponent = this.text[this.index];
    if (exponent === "e" || exponent === "E") {
      floatingPoint = true;
      this.index += 1;
      const sign = this.text[this.index];
      if (sign === "+" || sign === "-") this.index += 1;
      if (!this.isDigit(this.text[this.index])) throw new JsonSyntaxError();
      while (this.isDigit(this.text[this.index])) this.index += 1;
    }
    if (floatingPoint) failPacket("packet", "floating-point numbers are not allowed");

    const parsed = BigInt(this.text.slice(start, this.index));
    if (parsed > MAX_SAFE_INTEGER || parsed < -MAX_SAFE_INTEGER) {
      failPacket("packet", "integer exceeds the interoperable JSON range");
    }
    return Number(parsed);
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private skipWhitespace(): void {
    while (true) {
      const character = this.text[this.index];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") return;
      this.index += 1;
    }
  }
}

function decodeJsonInput(data: Uint8Array | string): string {
  if (typeof data === "string") {
    if (data.startsWith("\ufeff")) failPacket("packet", "UTF-8 BOM is not allowed");
    return data;
  }
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    failPacket("packet", "UTF-8 BOM is not allowed");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    failPacket("packet", "must be valid UTF-8");
  }
}

/** Parse duplicate-free, integer-only interoperable JSON without external dependencies. */
export function strictJsonParse(data: Uint8Array | string): JsonValue {
  const text = decodeJsonInput(data);
  let value: JsonValue;
  try {
    value = new StrictJsonParser(text).parse();
  } catch (error) {
    if (error instanceof PacketValidationError) throw error;
    failPacket("packet", "is not valid JSON");
  }
  rejectNonIJson(value);
  return value;
}
