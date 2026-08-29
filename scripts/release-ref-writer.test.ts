import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceWebsiteProductionRef,
  websiteProductionPushArguments,
} from "./release-ref-writer.mjs";

const previousSha = "1".repeat(40);
const verifiedSha = "2".repeat(40);
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

  test("keeps the token out of argv and config and cleans the bounded askpass helper", async () => {
    let askpassPath = "";
    let askpass = "";
    let childEnvironment: Readonly<Record<string, string>> = {};
    advanceWebsiteProductionRef({
      environment: { MLM_RELEASE_APP_TOKEN: token },
      expectedOldSha: previousSha,
      repository: "hraness/message-like-me",
      spawnImplementation(command, arguments_, options) {
        expect(command).toBe("/usr/bin/git");
        expect(arguments_.join(" ")).not.toContain(token);
        expect(arguments_.join(" ")).not.toContain("MLM_RELEASE_APP_TOKEN");
        expect(arguments_).toEqual(websiteProductionPushArguments(previousSha, verifiedSha));
        childEnvironment = options.env as Readonly<Record<string, string>>;
        askpassPath = childEnvironment.GIT_ASKPASS ?? "";
        askpass = readFileSync(askpassPath, "utf8");
        expect(statSync(askpassPath).mode & 0o777).toBe(0o700);
        expect(options.killSignal).toBe("SIGKILL");
        expect(options.timeout).toBe(60_000);
        return { error: undefined, signal: null, status: 0, stderr: "", stdout: "ok" } as never;
      },
      verifiedSha,
    });

    expect(askpass).toContain("x-access-token");
    expect(askpass).toContain('"$MLM_RELEASE_APP_TOKEN"');
    expect(askpass).not.toContain(token);
    expect(childEnvironment).toEqual({
      GIT_ASKPASS: askpassPath,
      GIT_ASKPASS_REQUIRE: "force",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      MLM_RELEASE_APP_TOKEN: token,
      PATH: "/usr/bin:/bin",
    });
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

  test("redacts token-bearing failures and leaves no askpass material", async () => {
    let askpassPath = "";
    expect(() => advanceWebsiteProductionRef({
      environment: { MLM_RELEASE_APP_TOKEN: token },
      expectedOldSha: previousSha,
      repository: "hraness/message-like-me",
      spawnImplementation(_command, _arguments, options) {
        askpassPath = (options.env as Readonly<Record<string, string>>).GIT_ASKPASS ?? "";
        return {
          error: undefined,
          signal: null,
          status: 1,
          stderr: `stale info accidentally contained ${token}`,
          stdout: "",
        } as never;
      },
      verifiedSha,
    })).toThrow("stale info accidentally contained [redacted]");
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
