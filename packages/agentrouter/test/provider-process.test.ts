import { expect, test } from "bun:test";
import { spawnBoundedProvider } from "../src/provider-process.ts";

const signal = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
};
function launch(source: string, onViolation = () => {}) {
  return spawnBoundedProvider({ executable: process.execPath, args: ["-e", source], cwd: process.cwd(),
    env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" }, onViolation });
}

test("root exit retains custody until a surviving process-group descendant is terminated", async () => {
  const childSource = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const source = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});child.once('spawn',()=>setTimeout(()=>{process.stdout.write(String(child.pid)+'\\n',()=>process.exit(0))},100));`;
  const custody = launch(source);
  let descendant = 0;
  try {
    let stdout = "";
    custody.process.stdout.setEncoding("utf8");
    for await (const chunk of custody.process.stdout) stdout += chunk;
    descendant = Number(stdout.trim());
    expect(Number.isSafeInteger(descendant) && descendant > 0).toBe(true);
    expect(signal(descendant)).toBe(true);
    expect(custody.isStopped()).toBe(false);
    await custody.stopAndJoin();
    expect(custody.isStopped()).toBe(true);
    expect(signal(descendant)).toBe(false);
  } finally {
    await custody.stopAndJoin();
  }
}, 10_000);

test.each([
  ["one oversized stdout frame", "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)", 1024 * 1024],
  ["cumulative stdout", "process.stdout.write(('x'.repeat(100*1024)+'\\n').repeat(100));setInterval(()=>{},1000)", 8 * 1024 * 1024],
  ["excess stderr", "process.stderr.write('x'.repeat(512*1024));setInterval(()=>{},1000)", 0],
] as const)("raw stream bounds terminate %s before unbounded SDK parsing", async (_name, source, maximum) => {
  let resolveViolation!: () => void;
  const violation = new Promise<void>((resolve) => { resolveViolation = resolve; });
  const custody = launch(source, resolveViolation);
  let received = 0;
  custody.process.stdout.on("data", (chunk: Buffer) => { received += chunk.byteLength; });
  try {
    await violation;
    await custody.stopAndJoin();
    expect(received).toBeLessThanOrEqual(maximum);
    expect(custody.isStopped()).toBe(true);
  } finally { await custody.stopAndJoin(); }
}, 10_000);
