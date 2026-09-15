import { dirname, join } from "node:path";
import { runTextbutlerCli } from "../../../packages/textbutler/src/cli.ts";
import { defaultLaunchAgentHost } from "../../../packages/textbutler/src/launch-agent.ts";
import { packagedProviderArtifact } from "./runtime-artifact.ts";

// This entry is bundled as cli.ts. The lifecycle's sibling URL must therefore
// identify this exact resource, including when the app is moved to Applications.
if (process.argv.slice(2).join(" ") === "--packaged-runtime-info") {
  const host = defaultLaunchAgentHost();
  console.log(JSON.stringify({ protocol: "textbutler.packaged-runtime.v1", bunVersion: Bun.version, runtime: host.runtime, entrypoint: host.entrypoint }));
} else {
  try {
    const host = defaultLaunchAgentHost();
    const providerArtifact = await packagedProviderArtifact(host.entrypoint);
    // The distribution builder places this prebuilt companion beside the
    // relocated CLI. Install mode copies it to the stable per-user location;
    // foreground mode can execute it directly. Neither path builds at launch.
    const menuBarBinary = join(dirname(host.entrypoint), "textbutler-menubar");
    process.exitCode = await runTextbutlerCli(process.argv.slice(2), process.stdout, { providerArtifact, menuBarBinary });
  }
  catch { process.stderr.write("Textbutler could not complete this operation. Owner state was preserved.\n"); process.exitCode = 1; }
}
