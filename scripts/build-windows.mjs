import { packager } from "@electron/packager"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { copyFile } from "node:fs/promises"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const applications = await packager({
  dir: root, name: "Elleson Docs", platform: "win32", arch: "x64",
  out: path.join(root, "dist"), overwrite: true, asar: false,
  electronVersion: "45.3.0", electronZipDir: process.env.ELLESON_ELECTRON_ZIP_DIR,
  icon: path.join(root, "web", "logo.ico"),
  appVersion: "0.1.0", buildVersion: "0.1.0",
  win32metadata: { CompanyName: "Elleson", ProductName: "Elleson Docs", FileDescription: "Elleson Docs document viewer" },
  ignore: [/^\/(\.git|\.build|dist|test|android|scripts)(\/|$)/],
  prune: true
})
for (const application of applications) {
  for (const file of ["Install.cmd", "Install-Elleson-Docs.ps1", "START-HERE.txt"]) {
    await copyFile(path.join(root, "scripts", file), path.join(application, file))
  }
  for (const file of ["NOTICE.md", "LICENSE"]) await copyFile(path.join(root, file), path.join(application, file))
  console.log(application)
}
