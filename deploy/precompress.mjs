// Writes .br and .gz next to every compressible static file so Caddy can serve
// them as-is (`file_server { precompressed br gzip }`) instead of compressing
// on each request. Run on the build output before upload:
//   node deploy/precompress.mjs dist/standalone/dist/client
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const root = process.argv[2];
if (!root) throw new Error("usage: node deploy/precompress.mjs <dir>");

const compressible = new Set([".js", ".mjs", ".css", ".svg", ".json", ".txt", ".html", ".webmanifest", ".xml", ".ttf", ".otf"]);
const minBytes = 1024;
let files = 0, before = 0, afterBr = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!compressible.has(extname(entry.name).toLowerCase())) continue;
    const { size } = await stat(path);
    if (size < minBytes) continue;
    const data = await readFile(path);
    const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: size } });
    const gz = gzipSync(data, { level: 9 });
    await writeFile(`${path}.br`, br);
    await writeFile(`${path}.gz`, gz);
    files += 1; before += size; afterBr += br.length;
  }
}

await walk(root);
console.log(`precompressed ${files} files: ${(before / 1e6).toFixed(1)} MB -> ${(afterBr / 1e6).toFixed(1)} MB brotli`);
