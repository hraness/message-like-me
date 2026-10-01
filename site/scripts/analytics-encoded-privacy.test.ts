import { expect, test } from "bun:test";
import { classifyAnalyticsRoute } from "@hraness/posthog";
import { pageNotFoundProperties, sanitizeProviderProperties } from "@hraness/posthog/event";
import { textbutlerPostHogSite } from "../app/_lib/analytics";

test("encoded identifiers are removed from public analytics paths and errors", () => {
  const path = "/blog/privacy-canary%40example.com";
  const url = `https://${textbutlerPostHogSite.canonicalDomain}${path}`;
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, url)).toMatchObject({
    canonical_path: "/blog/[email]",
    content_slug: "[email]",
  });
  expect(pageNotFoundProperties({ requestedPath: url })).toEqual({ requested_path: "/blog/[email]" });
  const properties = sanitizeProviderProperties(textbutlerPostHogSite, {
    $current_url: url,
    $pathname: path,
    requested_path: path,
    message: "Bearer%20private-token-canary",
  });
  expect(properties.$current_url).toBe(`https://${textbutlerPostHogSite.canonicalDomain}/blog/[email]`);
  expect(properties.$pathname).toBe("/blog/[email]");
  expect(properties.requested_path).toBe("/blog/[email]");
  expect(properties.message).toBe("Bearer%20[credential]");
  expect(JSON.stringify(properties)).not.toContain("canary");
  for (const email of ["+@a.aa", "%2B%40a.aa", "%252B%2540a.aa"]) {
    expect(classifyAnalyticsRoute(textbutlerPostHogSite, `https://${textbutlerPostHogSite.canonicalDomain}/blog/${email}`)).toMatchObject({ canonical_path: "/blog/[email]" });
    expect(sanitizeProviderProperties(textbutlerPostHogSite, { message: email }).message).toBe("[email]");
  }
});
