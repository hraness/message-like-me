import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestDaemon } from "../../../packages/textbutler/src/daemon.ts";
import { CONTROL_PROTOCOL } from "../../../packages/control/src/index.ts";
import { assertRuntime, BUN_VERSION, command, object, requireValue } from "../distribution/common.ts";
import { bundlePath } from "./package.ts";

export class PackagedCustodyUncertain extends Error { constructor() { super("Packaged daemon custody is uncertain; synthetic evidence retained"); } }

/** Actual packaged Bun/CLI, isolated synthetic owner state. No launchctl or provider. */
export async function smokePackagedRuntime(app: string): Promise<void> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "textbutler-package-")));
  const state = join(scratch, "state"), runtime = join(app, "Contents/Resources/textbutler-runtime"), bun = join(runtime, "textbutler-bun"), cli = join(runtime, "cli.ts");
  await mkdir(state, { mode: 0o700 });
  assertRuntime(runtime);
  const environment = { HOME: scratch, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: scratch };
  let clean = true;
  try {
    const info = object(JSON.parse(command(bun, ["--no-env-file", "--no-install", cli, "--packaged-runtime-info"], { environment, cwd: scratch }).toString("utf8")));
    requireValue(info.protocol === "textbutler.packaged-runtime.v1" && info.bunVersion === BUN_VERSION && info.runtime === bun && info.entrypoint === cli, "Packaged LaunchAgent launch coordinates differ");
    const probe = 'import {Database} from "bun:sqlite"; import {dlopen,FFIType} from "bun:ffi"; const db=new Database(":memory:"); if(db.query("select 1 as n").get().n!==1)throw Error();db.close();const lib=dlopen("/usr/lib/libSystem.B.dylib",{getpid:{args:[],returns:FFIType.i32}});if(lib.symbols.getpid()<=0)throw Error();lib.close();let sum=0;for(let i=0;i<1000000;i++)sum+=i;if(sum!==499999500000)throw Error();console.log("runtime mechanisms passed");';
    requireValue(command(bun, ["--no-env-file", "--no-install", "-e", probe], { environment, cwd: scratch }).toString("utf8") === "runtime mechanisms passed\n", "Packaged runtime mechanism probe failed");
    const child = Bun.spawn([bun, "--no-env-file", "--no-install", cli, "daemon", "run", "--data-dir", state], { env: environment, cwd: scratch, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    let exited = false; const joined = child.exited.then(code => { exited = true; return code; });
    const bound = async <T>(promise: Promise<T>, milliseconds: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Packaged runtime exceeded its deadline")), milliseconds); })]); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    };
    const reader = child.stdout.getReader();
    try {
      await bound((async () => {
        let bytes = Buffer.alloc(0);
        while (!bytes.includes(10)) { const next = await reader.read(); requireValue(!next.done, "Packaged daemon exited before readiness"); bytes = Buffer.concat([bytes, next.value]); requireValue(bytes.length <= 65_536, "Oversized packaged readiness output"); }
        requireValue(bytes.indexOf(10) === bytes.length - 1, "Packaged daemon emitted extra readiness frames");
        const ready = object(JSON.parse(bytes.toString("utf8")));
        requireValue(ready.ok === true && ready.status === "running" && ready.socketPath === join(state, "daemon.sock"), "Packaged daemon readiness differs");
        const response = await requestDaemon({ dataDir: state, request: { protocol: CONTROL_PROTOCOL, command: "snapshot" } });
        requireValue(response.ok && response.kind === "snapshot" && response.snapshot.connection === "connected" && response.snapshot.settings.paused && response.snapshot.contacts.length === 0, "Packaged daemon did not start paused and empty");
      })(), 30_000);
      child.kill("SIGTERM"); requireValue(await bound(joined, 15_000) === 0, "Packaged daemon did not stop cleanly");
    } finally {
      if (!exited) { child.kill("SIGTERM"); try { await bound(joined, 15_000); } catch { child.kill("SIGKILL"); try { await bound(joined, 5_000); } catch { clean = false; } } }
      reader.releaseLock();
      if (!clean) throw new PackagedCustodyUncertain();
    }
  } finally { if (clean) await rm(scratch, { recursive: true, force: true }); }
}
if (import.meta.main) {
  requireValue(process.argv.length === 2 && process.platform === "darwin" && process.arch === "arm64", "Requires the exact packaged Apple Silicon app");
  await smokePackagedRuntime(bundlePath);
  console.log("Actual bundled Bun/CLI passed flags, relocated launch identity, JIT/SQLite/FFI, paused empty daemon, socket control, and clean shutdown. No live provider or LaunchAgent was used.");
}
