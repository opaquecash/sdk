import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const apiDir = fileURLToPath(new URL("../../docs/sdk/api/", import.meta.url));
const rootRelativeViemLink = /\]\(\/docs\/([^)\s]+)\)/g;

async function* markdownFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* markdownFiles(path);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield path;
    }
  }
}

for await (const file of markdownFiles(apiDir)) {
  const current = await readFile(file, "utf8");
  const next = current.replace(rootRelativeViemLink, "](https://viem.sh/docs/$1)");
  if (next !== current) {
    await writeFile(file, next);
  }
}
