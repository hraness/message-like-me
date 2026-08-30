const child = Bun.spawn(["npm", "--version"], { stdout: "pipe", stderr: "pipe" });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill(9);
}, 10_000);
const [exitCode, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]).finally(() => clearTimeout(timer));
if (timedOut) throw new Error("npm --version timed out.");
if (stdout.length > 128 || stderr.length > 1_024) throw new Error("npm --version output exceeded its bound.");
if (exitCode !== 0) throw new Error("npm --version failed.");
const version = stdout.trim();
const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u.exec(version);
if (match === null) throw new Error(`npm returned an invalid version: ${version}`);
const [, majorText, minorText, patchText] = match;
const [major, minor, patch] = [majorText, minorText, patchText].map(Number) as [number, number, number];
const supported = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
if (!supported) throw new Error(`npm ${version} is too old for trusted publishing; require >=11.5.1.`);
console.log(`npm ${version} supports trusted publishing.`);
