import { exportHabitatStudy } from "../packages/textbutler/src/habitat-study.ts";
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--journal" || args[2] !== "--out") {
  console.error("Usage: bun scripts/export-textbutler-study.ts --journal ABSOLUTE_PRIVATE_JOURNAL --out NEW_PRIVATE_FILE");
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(await exportHabitatStudy(args[1]!, args[3]!))); }
  catch { console.error("Private study export failed. Check owned private paths, source bounds and a new output filename."); process.exitCode = 1; }
}
