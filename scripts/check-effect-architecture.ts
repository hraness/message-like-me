import { resolve } from "node:path";
import { createArchitectureProgram, inspectEffectArchitecture } from "./effect-architecture.ts";

const root = resolve(import.meta.dir, "..");
export const commandEffectPolicy = {
  root,
  modules: ["src/commands.ts", "src/command-program.ts", "src/command-platform.ts", "src/command-artifacts.ts",
    "src/skill-install-model.ts", "src/skill-install-program.ts", "src/skill-install-platform.ts"],
  adapters: ["src/command-platform.ts", "src/command-artifacts.ts", "src/skill-install-platform.ts"],
  runtimeRoots: ["src/commands.ts"],
  ignoredDirectories: ["scripts"],
};

export function commandEffectProblems(): string[] {
  return inspectEffectArchitecture(createArchitectureProgram(resolve(root, "tsconfig.json")), commandEffectPolicy)
    .map((finding) => `${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`);
}
if (import.meta.main) {
  const problems = commandEffectProblems();
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
  else console.log("Effect command ownership, channels, and execution boundaries verified.");
}
