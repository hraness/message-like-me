/** Bounded kernel-boundary probe: synthetic files/loopback only; no accounts or model calls. */
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { syntheticMacSandbox } from "./macos-sandbox-profile.ts";
if (process.platform !== "darwin") throw new Error("REQUIRES_MACOS");
const root = await realpath(await mkdtemp(join(tmpdir(), "textbutler-kernel-probe-")));
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const scratch = join(root, "allowed"), outside = join(root, "foreign");
  await mkdir(scratch, { mode: 0o700 }); await mkdir(outside, { mode: 0o700 });
  const canary = join(outside, "canary"); await writeFile(canary, "synthetic-private-canary", { mode: 0o600 });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("synthetic") });
  const executable = join(root, "probe"), source = join(root, "probe.c");
  await writeFile(source, `#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <spawn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/wait.h>
extern char **environ;
int denied_read(const char *p) { int fd=open(p,O_RDONLY|O_NONBLOCK); if(fd>=0){close(fd);return 0;}return errno==EPERM||errno==EACCES; }
int denied_write(const char *p) { int fd=open(p,O_WRONLY|O_CREAT,0600);if(fd>=0){close(fd);return 0;}return errno==EPERM||errno==EACCES; }
int net(int port) { int fd=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(port)};inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);int r=connect(fd,(struct sockaddr*)&a,sizeof(a));int e=errno;close(fd);return r==0?0:e; }
int main(int argc,char **argv) {
  fprintf(stderr,"probe-start\\n");
  int fd=open(argv[1],O_WRONLY|O_CREAT,0600), own=fd>=0;if(fd>=0){write(fd,"own",3);close(fd);}
  int foreignRead=denied_read(argv[2]), foreignWrite=denied_write(argv[3]);
  int foreignFifo=denied_read(argv[5]), foreignDirectory=denied_read(argv[6]);
  fprintf(stderr,"files-complete own=%d read=%d write=%d\\n",own,foreignRead,foreignWrite);
  pid_t child;char *args[]={"/usr/bin/true",NULL};int spawnError=posix_spawn(&child,args[0],NULL,NULL,args,environ);if(!spawnError)waitpid(child,NULL,0);
  fprintf(stderr,"spawn-complete errno=%d\\n",spawnError);
  pid_t f=fork();int forkDenied=f<0&&(errno==EPERM||errno==EACCES);if(f==0)_exit(0);if(f>0)waitpid(f,NULL,0);
  fprintf(stderr,"fork-complete denied=%d\\n",forkDenied);
  int local=net(atoi(argv[4])), other=net(atoi(argv[4])==65535?65534:atoi(argv[4])+1);
  printf("{\\\"ownWrite\\\":%s,\\\"foreignReadDenied\\\":%s,\\\"foreignWriteDenied\\\":%s,\\\"spawnDenied\\\":%s,\\\"forkDenied\\\":%s,\\\"loopbackAllowed\\\":%s,\\\"otherPortDenied\\\":%s}\\n",own?"true":"false",foreignRead?"true":"false",foreignWrite?"true":"false",spawnError==EPERM||spawnError==EACCES?"true":"false",forkDenied?"true":"false",local==0?"true":"false",other==EPERM||other==EACCES?"true":"false");
  fprintf(stderr,"foreign-fifo-denied=%d foreign-directory-denied=%d\\n",foreignFifo,foreignDirectory);
  return !(own&&foreignRead&&foreignWrite&&foreignFifo&&foreignDirectory&&(spawnError==EPERM||spawnError==EACCES)&&forkDenied&&local==0&&(other==EPERM||other==EACCES));
}
`.replace("#include <stdio.h>", "#include <stdio.h>\n#include <stdlib.h>"));
  async function run(argv: string[], cwd: string, timeout: number) {
    const child = Bun.spawn(argv, { cwd, env: { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: scratch }, stdout: "pipe", stderr: "pipe", timeout });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  }
  const built = await run(["/usr/bin/clang", "-O0", "-o", executable, source], root, 30_000);
  if (built.code !== 0) throw new Error(`SYNTHETIC_COMPILE_FAILED ${built.stderr.slice(0, 1000)}`);
  const fifo = join(outside, "foreign-fifo");
  if ((await run(["/usr/bin/mkfifo", "-m", "600", fifo], root, 10_000)).code !== 0) throw new Error("SYNTHETIC_FIFO_SETUP_FAILED");
  const profile = syntheticMacSandbox({ executable, scratch: [scratch], port: server.port! });
  const result = await run(["/usr/bin/sandbox-exec", "-p", profile, executable, join(scratch, "own"), canary, join(outside, "write"), String(server.port), fifo, outside], scratch, 10_000);
  console.log(JSON.stringify({ profile: "experimental-macos-kernel-fixture", productionQualificationIssued: false, paidModelRequests: 0,
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    profileSha256: createHash("sha256").update(profile).digest("hex"), ...result }, null, 2));
  if (result.code !== 0 || await readFile(canary, "utf8") !== "synthetic-private-canary") process.exitCode = 1;
} finally { await server?.stop(true); await rm(root, { recursive: true, force: true }); }
