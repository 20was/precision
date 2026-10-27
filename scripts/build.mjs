import { build, context } from "esbuild";
import {
  copyFile,
  mkdir,
  cp,
  rm,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { join, relative } from "node:path";

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
  await mkdir("dist", { recursive: true });
  await cp("public", "dist", { recursive: true, force: true });
  const ctx = await context(options);
  await ctx.watch();
  console.log(
    "Watching TypeScript; reload extension after changes. Restart for public/ changes.",
  );
} else {
  // Build away from the unpacked extension directory. Removing dist while a
  // browser has it loaded can briefly remove worker.js and strand the install
  // in a service-worker registration error. Publish each completed file via a
  // same-directory rename so the browser never observes a partial bundle.
  const staging = ".precision-build-staging";
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await cp("public", staging, { recursive: true });
    await build({ ...options, outdir: staging });
    await mkdir("dist", { recursive: true });
    const publish = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const source = join(directory, entry.name);
        const destination = join("dist", relative(staging, source));
        if (entry.isDirectory()) {
          await mkdir(destination, { recursive: true });
          await publish(source);
        } else if (entry.isFile()) {
          await mkdir(join(destination, ".."), { recursive: true });
          const temporary = `${destination}.precision-tmp`;
          await copyFile(source, temporary);
          await rename(temporary, destination);
        }
      }
    };
    await publish(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  for (const file of await readdir("dist"))
    console.log(`${file}: ${(await stat(`dist/${file}`)).size} bytes`);
}
