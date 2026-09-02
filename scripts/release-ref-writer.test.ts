import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceWebsiteProductionRef,
  verifiedReleaseFetchArguments,
  websiteProductionPushArguments,
} from "./release-ref-writer.mjs";

const previousSha = "1".repeat(40);
const verifiedSha = "2".repeat(40);
const verifiedTag = "v0.8.0";
const token = "ghs_private-release-token-value";

describe("website-production Git writer", () => {
  test("builds one fixed refspec with one nonempty exact explicit lease", () => {
    const arguments_ = websiteProductionPushArguments(previousSha, verifiedSha);
    expect(arguments_).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "http.extraHeader=",
      "-c",
      "push.followTags=false",
      "-c",
      "push.gpgSign=false",
      "push",
      "--porcelain",
      `--force-with-lease=refs/heads/website-production:${previousSha}`,
      "--no-follow-tags",
      "--no-tags",
      "--no-signed",
      "--no-verify",
      "--recurse-submodules=no",
      "https://github.com/hraness/message-like-me.git",
      `${verifiedSha}:refs/heads/website-production`,
    ]);
    expect(arguments_.filter((value) => value.startsWith("--force-with-lease="))).toHaveLength(1);
    expect(arguments_.filter((value) => value.endsWith(":refs/heads/website-production")))
      .toEqual([`${verifiedSha}:refs/heads/website-production`]);
    expect(arguments_).not.toContain("--force");
    expect(arguments_.join(" ")).not.toContain("*");
    expect(arguments_.join(" ")).not.toContain(" :refs/heads/website-production");
  });

  test("fetches only one exact stable tag without following tags or submodules", () => {
    expect(verifiedReleaseFetchArguments(verifiedTag)).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "http.extraHeader=",
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--depth=1",
      "https://github.com/hraness/message-like-me.git",
      "refs/tags/v0.8.0",
    ]);
    for (const value of ["", "0.8.0", "v01.2.3", "v1.2", "v1.2.3\nmain"] as const) {
      expect(() => verifiedReleaseFetchArguments(value)).toThrow(
        "verified release tag is not one stable semantic-version tag",
      );
    }
  });

  test("fetches, peels, and pushes under one bounded credential boundary", async () => {
    let askpassPath = "";
    let askpass = "";
    const calls: Array<Readonly<{
      arguments: readonly string[];
      environment: Readonly<Record<string, string>>;
    }>> = [];
    advanceWebsiteProductionRef({
      environment: { MLM_RELEASE_APP_TOKEN: token },
      expectedOldSha: previousSha,
      repository: "hraness/message-like-me",
      spawnImplementation(command, arguments_, options) {
        expect(command).toBe("/usr/bin/git");
        expect(arguments_.join(" ")).not.toContain(token);
        expect(arguments_.join(" ")).not.toContain("MLM_RELEASE_APP_TOKEN");
        expect(options.killSignal).toBe("SIGKILL");
        expect(options.timeout).toBe(60_000);
        const environment = options.env as Readonly<Record<string, string>>;
        calls.push({ arguments: [...arguments_], environment });
        if (calls.length === 1) {
          askpassPath = environment.GIT_ASKPASS ?? "";
          askpass = readFileSync(askpassPath, "utf8");
          expect(statSync(askpassPath).mode & 0o777).toBe(0o700);
          return { error: undefined, signal: null, status: 0, stderr: "", stdout: "" } as never;
        }
        if (calls.length === 2) {
          return {
            error: undefined,
            signal: null,
            status: 0,
            stderr: "",
            stdout: `${verifiedSha}\n`,
          } as never;
        }
        return { error: undefined, signal: null, status: 0, stderr: "", stdout: "ok" } as never;
      },
      verifiedSha,
      verifiedTag,
    });

    expect(calls.map((call) => call.arguments)).toEqual([
      verifiedReleaseFetchArguments(verifiedTag),
      ["-c", "core.hooksPath=/dev/null", "rev-parse", "--verify", "FETCH_HEAD^{commit}"],
      websiteProductionPushArguments(previousSha, verifiedSha),
    ]);
    expect(askpass).toContain("x-access-token");
    expect(askpass).toContain('"$MLM_RELEASE_APP_TOKEN"');
    expect(askpass).not.toContain(token);
    const commonEnvironment = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
    };
    expect(calls[0]?.environment).toEqual({
      ...commonEnvironment,
      GIT_ASKPASS: askpassPath,
      GIT_ASKPASS_REQUIRE: "force",
      MLM_RELEASE_APP_TOKEN: token,
    });
    expect(calls[1]?.environment).toEqual(commonEnvironment);
    expect(calls[2]?.environment).toEqual(calls[0]?.environment);
    expect(await Bun.file(askpassPath).exists()).toBe(false);
  });

  test("rejects bare, empty, remote-tracking, wildcard, creation, deletion, and multi-ref shapes", () => {
    for (const value of ["", "0".repeat(39), "A".repeat(40), "refs/remotes/origin/main", "*"] as const) {
      expect(() => websiteProductionPushArguments(value, verifiedSha)).toThrow(
        "expected website-production SHA is not one exact lowercase SHA",
      );
    }
    expect(() => websiteProductionPushArguments(previousSha, "")).toThrow(
      "verified release SHA is not one exact lowercase SHA",
    );
    expect(() => websiteProductionPushArguments(previousSha, previousSha)).toThrow(
      "website-production is already exact",
    );
  });

  test("rejects a fetched tag that peels to another commit before push", () => {
    let calls = 0;
    expect(() => advanceWebsiteProductionRef({
      environment: { MLM_RELEASE_APP_TOKEN: token },
      expectedOldSha: previousSha,
      repository: "hraness/message-like-me",
      spawnImplementation() {
        calls += 1;
        return {
          error: undefined,
          signal: null,
          status: 0,
          stderr: "",
          stdout: calls === 2 ? `${"3".repeat(40)}\n` : "",
        } as never;
      },
      verifiedSha,
      verifiedTag,
    })).toThrow("fetched release tag does not peel to the verified release SHA");
    expect(calls).toBe(2);
  });

  test("redacts token-bearing push failures and leaves no askpass material", async () => {
    let askpassPath = "";
    let calls = 0;
    expect(() => advanceWebsiteProductionRef({
      environment: { MLM_RELEASE_APP_TOKEN: token },
      expectedOldSha: previousSha,
      repository: "hraness/message-like-me",
      spawnImplementation(_command, _arguments, options) {
        calls += 1;
        askpassPath = (options.env as Readonly<Record<string, string>>).GIT_ASKPASS ?? "";
        if (calls === 1) {
          return { error: undefined, signal: null, status: 0, stderr: "", stdout: "" } as never;
        }
        if (calls === 2) {
          return {
            error: undefined,
            signal: null,
            status: 0,
            stderr: "",
            stdout: `${verifiedSha}\n`,
          } as never;
        }
        return {
          error: undefined,
          signal: null,
          status: 1,
          stderr: `stale info accidentally contained ${token}`,
          stdout: "",
        } as never;
      },
      verifiedSha,
      verifiedTag,
    })).toThrow("stale info accidentally contained [redacted]");
    expect(calls).toBe(3);
    expect(await Bun.file(askpassPath).exists()).toBe(false);
  });
});

describe("explicit lease integration", () => {
  test("a stale expected-old lease rejects without mutating the remote ref", async () => {
    const directory = await mkdtemp(join(tmpdir(), "message-like-me-ref-lease-"));
    const remote = join(directory, "remote.git");
    const source = join(directory, "source");
    const run = (arguments_: readonly string[], cwd = source) => {
      const result = Bun.spawnSync(["git", ...arguments_], { cwd, stderr: "pipe", stdout: "pipe" });
      return Object.freeze({
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      });
    };
    const checked = (arguments_: readonly string[], cwd = source) => {
      const result = run(arguments_, cwd);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };

    try {
      checked(["init", "--bare", remote], directory);
      checked(["init", source], directory);
      checked(["config", "user.name", "Message Like Me test"]);
      checked(["config", "user.email", "test@example.invalid"]);
      const file = join(source, "value.txt");
      await writeFile(file, "one\n", "utf8");
      checked(["add", "value.txt"]);
      checked(["commit", "-m", "one"]);
      const first = checked(["rev-parse", "HEAD"]);
      checked(["push", remote, `${first}:refs/heads/website-production`]);

      await writeFile(file, "two\n", "utf8");
      checked(["commit", "-am", "two"]);
      const second = checked(["rev-parse", "HEAD"]);
      const firstArguments = websiteProductionPushArguments(first, second).map((value) =>
        value === "https://github.com/hraness/message-like-me.git" ? remote : value
      );
      checked(firstArguments);
      expect(checked(["--git-dir", remote, "rev-parse", "refs/heads/website-production"], directory))
        .toBe(second);

      await writeFile(file, "three\n", "utf8");
      checked(["commit", "-am", "three"]);
      const third = checked(["rev-parse", "HEAD"]);
      const staleArguments = websiteProductionPushArguments(first, third).map((value) =>
        value === "https://github.com/hraness/message-like-me.git" ? remote : value
      );
      const stale = run(staleArguments);
      expect(stale.exitCode).not.toBe(0);
      expect(`${stale.stdout}${stale.stderr}`).toContain("failed to push some refs");
      expect(checked(["--git-dir", remote, "rev-parse", "refs/heads/website-production"], directory))
        .toBe(second);
    } finally {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("exact release tag fetch integration", () => {
  test("imports only the annotated tag commit into FETCH_HEAD without moving workflow HEAD", async () => {
    const directory = await mkdtemp(join(tmpdir(), "message-like-me-tag-fetch-"));
    const remote = join(directory, "remote.git");
    const source = join(directory, "source");
    const checkout = join(directory, "checkout");
    const run = (arguments_: readonly string[], cwd: string) => {
      const result = Bun.spawnSync(["git", ...arguments_], { cwd, stderr: "pipe", stdout: "pipe" });
      return Object.freeze({
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      });
    };
    const checked = (arguments_: readonly string[], cwd: string) => {
      const result = run(arguments_, cwd);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };

    try {
      checked(["init", "--bare", remote], directory);
      checked(["init", "--initial-branch=main", source], directory);
      checked(["config", "user.name", "Message Like Me test"], source);
      checked(["config", "user.email", "test@example.invalid"], source);
      const file = join(source, "value.txt");
      await writeFile(file, "release\n", "utf8");
      checked(["add", "value.txt"], source);
      checked(["commit", "-m", "release"], source);
      const releaseSha = checked(["rev-parse", "HEAD"], source);
      checked(["tag", "-a", verifiedTag, "-m", "release"], source);
      const tagObjectSha = checked(["rev-parse", verifiedTag], source);
      expect(tagObjectSha).not.toBe(releaseSha);

      await writeFile(file, "current workflow\n", "utf8");
      checked(["commit", "-am", "current workflow"], source);
      const workflowSha = checked(["rev-parse", "HEAD"], source);
      checked(["push", remote, "main", `refs/tags/${verifiedTag}`], source);

      checked(["init", "--initial-branch=main", checkout], directory);
      checked(["fetch", "--no-tags", `file://${remote}`, "refs/heads/main"], checkout);
      checked(["checkout", "--detach", "FETCH_HEAD"], checkout);
      expect(checked(["rev-parse", "HEAD"], checkout)).toBe(workflowSha);

      const fetchArguments = verifiedReleaseFetchArguments(verifiedTag).map((value) =>
        value === "https://github.com/hraness/message-like-me.git" ? `file://${remote}` : value
      );
      checked(fetchArguments, checkout);
      expect(checked(["rev-parse", "HEAD"], checkout)).toBe(workflowSha);
      expect(checked(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], checkout)).toBe(releaseSha);
      expect(run(["show-ref", "--tags"], checkout)).toMatchObject({ exitCode: 1, stdout: "" });
    } finally {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  });
});
