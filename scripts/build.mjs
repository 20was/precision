import { build, context } from "esbuild";
import { mkdir, cp, rm, readdir, stat } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const options = {
  entryPoints: [
    "src/worker.ts",
    "src/content.ts",
    "src/popup.ts",
    "src/editor.ts",
  ],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  legalComments: "none",
};
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(
    "Watching TypeScript; reload extension after changes. Restart for public/ changes.",
  );
} else {
  await build(options);
  for (const file of await readdir("dist"))
    console.log(`${file}: ${(await stat(`dist/${file}`)).size} bytes`);
}
