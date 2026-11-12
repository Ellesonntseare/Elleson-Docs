import { build } from "esbuild"
import { mkdir, cp } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, ".build", "android-assets", "app")
await mkdir(target, { recursive: true })
await build({
  entryPoints: [path.join(root, "offline-engine.mjs")], outfile: path.join(root, "web", "offline-runtime.mjs"),
  bundle: true, format: "esm", platform: "browser", target: "es2022",
  plugins: [{ name: "mupdf-browser", setup(builder) {
    builder.onResolve({ filter: /^mupdf$/ }, () => ({ path: "/vendor/mupdf/mupdf.js", external: true }))
  } }]
})
await build({
  entryPoints: [path.join(root, "scan-engine.mjs")], outfile: path.join(root, "web", "scan-runtime.mjs"),
  bundle: true, format: "esm", platform: "browser", target: "es2022"
})
await cp(path.join(root, "web"), target, { recursive: true })
for (const [source, destination] of [
  ["pdfjs-dist/legacy/build", "pdfjs/legacy/build"], ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"], ["pdfjs-dist/wasm", "pdfjs/wasm"],
  ["mupdf/dist", "vendor/mupdf"], ["jszip/dist", "vendor/jszip"], ["docx-preview/dist", "vendor/docx"],
  ["tesseract.js/dist", "vendor/tesseract"], ["tesseract.js-core", "vendor/tesseract-core"]
]) await cp(path.join(root, "node_modules", source), path.join(target, destination), {
  recursive: true, filter: source => !/\.(map|br|ts)$/.test(source)
})
await mkdir(path.join(target, "vendor/ocr-data"), { recursive: true })
for (const code of ["eng", "fra", "spa"]) {
  const language = require("@tesseract.js-data/" + code)
  await cp(path.join(language.langPath, code + ".traineddata.gz"), path.join(target, "vendor/ocr-data", code + ".traineddata.gz"))
}
console.log(target)
