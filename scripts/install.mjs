import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  rename,
  rm,
  realpath,
  access,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(project, ".runtime");
const version = "2.0.3";
const extensionVersion = "1.0.27";
const extensionHash =
  "8636d42a0fe44d7ba3b0603dbcd9581e8269ccbca950136d0dfc0ffc39a8a213";
const binDirectory = resolve(
  process.env.XHS_INSTALL_BIN_DIR || join(homedir(), ".local/bin"),
);
const skillDirectory = resolve(
  process.env.XHS_INSTALL_SKILL_DIR || join(homedir(), ".codex/skills"),
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function run(command, args, options = {}) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: project,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : reject(new Error("Install step failed (" + code + ")")),
    );
  });
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function installExtension() {
  const destination = join(runtime, "browser-extension");
  if (await exists(join(destination, "manifest.json"))) {
    const manifest = JSON.parse(
      await readFile(join(destination, "manifest.json"), "utf8"),
    );
    if (manifest.version === extensionVersion) return destination;
    throw new Error(
      "Existing extension version differs; move .runtime/browser-extension aside before reinstalling",
    );
  }
  const stage = join(runtime, "extension-download-" + randomUUID());
  await mkdir(stage);
  try {
    const response = await fetch(
      "https://github.com/jackwener/OpenCLI/releases/download/v" +
        version +
        "/opencli-extension-v" +
        extensionVersion +
        ".zip",
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok)
      throw new Error("Extension download failed, HTTP " + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== extensionHash)
      throw new Error("Extension SHA256 mismatch");
    const archive = join(stage, "extension.zip");
    await writeFile(archive, bytes);
    const unpacked = join(stage, "unpacked");
    await mkdir(unpacked);
    await run("unzip", ["-q", archive, "-d", unpacked]);
    const manifest = JSON.parse(
      await readFile(join(unpacked, "manifest.json"), "utf8"),
    );
    if (manifest.version !== extensionVersion)
      throw new Error("Extension manifest version mismatch");
    await rename(unpacked, destination);
    return destination;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
async function install() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Run bash install.sh to install Node 24");
  await mkdir(runtime, { recursive: true });
  // A directory lock prevents concurrent installers from replacing dependencies.
  const installLock = join(runtime, "install.lock");
  try {
    await mkdir(installLock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Installer already running; inspect .runtime/install.lock",
      );
    throw error;
  }
  try {
    await run("npm", ["ci", "--no-audit", "--no-fund"]);
    const prefix = join(runtime, "opencli");
    await run("npm", [
      "install",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      "--save-exact",
      "--registry=https://registry.npmjs.org",
      "@jackwener/opencli@" + version,
    ]);
    const opencli = join(prefix, "node_modules/.bin/opencli");
    const extension = await installExtension();
    await mkdir(binDirectory, { recursive: true });
    const entry = join(binDirectory, "xhs-workflow");
    if (await exists(entry)) {
      const current = await readFile(entry, "utf8");
      const ownSymlink =
        (await realpath(entry)) === join(project, "src/cli.mjs");
      if (!current.includes("# xhs-workflow managed installer") && !ownSymlink)
        throw new Error(
          "CLI path already contains another installation; choose XHS_INSTALL_BIN_DIR",
        );
      // Rename an atomic temporary wrapper over the path, preserving the source behind a symlink.
    }
    const wrapper = [
      "#!/usr/bin/env bash",
      "# xhs-workflow managed installer",
      "set -e",
      "export PATH=" + quote(dirname(process.execPath)) + ':"$PATH"',
      'if [[ -z "${XHS_OPENCLI_BIN:-}" ]]; then',
      "  export XHS_OPENCLI_BIN=" + quote(opencli),
      "fi",
      "exec " +
        quote(process.execPath) +
        " " +
        quote(join(project, "src/cli.mjs")) +
        ' "$@"',
      "",
    ].join("\n");
    const tempEntry = entry + "." + randomUUID() + ".tmp";
    await writeFile(tempEntry, wrapper, { mode: 0o755 });
    await rename(tempEntry, entry);
    const skill = join(skillDirectory, "xiaohongshu-draft-workflow");
    await mkdir(skillDirectory, { recursive: true });
    if (await exists(skill)) {
      const old = await readFile(join(skill, "SKILL.md"), "utf8");
      if (!old.includes("name: xiaohongshu-draft-workflow"))
        throw new Error("Skill destination belongs to another skill");
    }
    await cp(join(project, "skills/xiaohongshu-draft-workflow"), skill, {
      recursive: true,
    });
    const environment = { ...process.env, XHS_OPENCLI_BIN: opencli };
    await run(process.execPath, [join(project, "src/cli.mjs"), "doctor"], {
      env: environment,
    });
    console.log("\n安装完成。CLI 路径 " + entry);
    console.log("浏览器扩展目录 " + extension);
    console.log(
      "在 Chrome 打开 chrome://extensions，开启开发者模式，加载该目录。也可使用 README 中的 Chrome 商店链接。",
    );
    console.log(
      "登录小红书与创作平台后执行 " + quote(entry) + " doctor --live",
    );
    console.log(
      "如命令未加入 PATH，执行 export PATH=" + quote(binDirectory) + ':"$PATH"',
    );
    console.log(
      "API 凭据请在本机配置，参考 README。安装器不会收集或保存凭据。",
    );
  } finally {
    await rm(installLock, { recursive: true, force: true });
  }
}
install().catch((error) => {
  console.error(error.message);
  console.error(
    "安装未完成。请检查上方失败步骤、网络、目录权限，以及 Chrome 扩展解压工具 unzip。修复后可重新执行 bash install.sh。",
  );
  process.exitCode = 1;
});
