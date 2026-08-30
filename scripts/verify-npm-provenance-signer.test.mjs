import { describe, expect, test } from "bun:test";

import { releaseSignerIdentity } from "./verify-npm-provenance-signer.mjs";

const tag = "v0.8.1";
const sha = "a".repeat(40);
const ref = `refs/tags/${tag}`;
const identity =
  `https://github.com/hraness/message-like-me/.github/workflows/release.yml@${ref}`;
const invocation = "https://github.com/hraness/message-like-me/actions/runs/123/attempts/3";

describe("npm Sigstore release signer policy", () => {
  test("binds the Fulcio signer to the exact GitHub Actions workflow, tag, repository, and commit", () => {
    const policy = releaseSignerIdentity(tag, sha, invocation);
    expect(policy.identity).toBe(identity);
    expect(policy.options.certificateIssuer).toBe("https://token.actions.githubusercontent.com");
    expect(new RegExp(policy.options.certificateIdentityURI, "u").test(identity)).toBe(true);
    expect(new RegExp(policy.options.certificateIdentityURI, "u").test(`${identity}-attacker`)).toBe(false);
    expect(policy.options.certificateOIDs).toEqual({
      "1.3.6.1.4.1.57264.1.2": "push",
      "1.3.6.1.4.1.57264.1.3": sha,
      "1.3.6.1.4.1.57264.1.5": "hraness/message-like-me",
      "1.3.6.1.4.1.57264.1.6": ref,
      "1.3.6.1.4.1.57264.1.11": "github-hosted",
      "1.3.6.1.4.1.57264.1.12": "https://github.com/hraness/message-like-me",
      "1.3.6.1.4.1.57264.1.13": sha,
      "1.3.6.1.4.1.57264.1.14": ref,
      "1.3.6.1.4.1.57264.1.15": "1342143606",
      "1.3.6.1.4.1.57264.1.18": identity,
      "1.3.6.1.4.1.57264.1.19": sha,
      "1.3.6.1.4.1.57264.1.20": "push",
      "1.3.6.1.4.1.57264.1.21": invocation,
      "1.3.6.1.4.1.57264.1.22": "public",
      "1.3.6.1.4.1.57264.1.24": `repo:hraness/message-like-me:ref:${ref}`,
    });
  });

  test("rejects non-stable tags and malformed commits before verification", () => {
    expect(() => releaseSignerIdentity("latest", sha, invocation)).toThrow("coordinates");
    expect(() => releaseSignerIdentity(tag, "not-a-commit", invocation)).toThrow("coordinates");
    expect(() => releaseSignerIdentity(tag, sha, `${invocation}-attacker`)).toThrow("coordinates");
  });
});
