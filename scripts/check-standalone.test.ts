import { expect, test } from "bun:test";
import { PRIVATE_TEMPORARY_PATH } from "./check-standalone.ts";

test("privacy scanning admits only the exact public macOS resolver socket", () => {
  for (const source of [
    '(literal "/private/var/run/mDNSResponder")',
    "'/private/var/run/mDNSResponder'",
    "`/private/var/run/mDNSResponder`",
    "/private/var/run/mDNSResponder",
  ]) expect(PRIVATE_TEMPORARY_PATH.test(source)).toBe(false);
});

test("resolver admission preserves temporary, sibling and suffix path detection", () => {
  for (const source of [
    '"/private/tmp/private-fixture"',
    '"/private/tmp/run/mDNSResponder"',
    '"/private/var/folders/private-fixture"',
    '"/private/var/run/other-socket"',
    '"/private/var/run/"',
    '"/private/var/run/mDNSResponder/private-fixture"',
    '"/private/var/run/mDNSResponder.log"',
    '"/private/var/run/mDNSResponder private-fixture"',
    '"/private/var/run/mDNSResponder\\private-fixture"',
    '"/private/var/run/mDNSResponder"; "/private/tmp/private-fixture"',
  ]) expect(PRIVATE_TEMPORARY_PATH.test(source)).toBe(true);
});
