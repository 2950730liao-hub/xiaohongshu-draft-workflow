import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, realpath, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { saveXhsDraftInBrowser, findXhsDraft } from "./draft-browser.mjs";
import { sourceId } from "./discovery.mjs";
const exec = promisify(execFile);
export async function binary() {
  const candidates = process.env.XHS_OPENCLI_BIN
    ? [process.env.XHS_OPENCLI_BIN]
    : [
        fileURLToPath(
          new URL(
            "../.runtime/opencli/node_modules/.bin/opencli",
            import.meta.url,
          ),
        ),
        join(homedir(), ".local/bin/opencli"),
        join(
          homedir(),
          ".local/share/pengchen-web/xhs-opencli/node_modules/.bin/opencli",
        ),
      ];
  for (const file of candidates) {
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      /* Try the next explicit installation. */
    }
  }
  throw new Error(
    "OpenCLI unavailable. Set XHS_OPENCLI_BIN to your existing installation.",
  );
}
export async function call(command, args = []) {
  const allowed = ["search", "note", "comments", "creator-profile", "whoami"];
  if (!allowed.includes(command)) throw new Error("Unsupported read command");
  let stdout;
  try {
    ({ stdout } = await exec(
      await binary(),
      ["xiaohongshu", command, "-f", "json", ...args],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch {
    throw new Error(
      `OpenCLI ${command} failed. Check Chrome login, bridge and platform verification locally.`,
    );
  }
  const result = JSON.parse(stdout);
  const rows = Array.isArray(result) ? result : result.ok && result.data;
  if (!Array.isArray(rows)) throw new Error("Unexpected OpenCLI response");
  return rows;
}
export const adapter = {
  search: (query, limit) =>
    call("search", ["--limit", String(limit), "--", query]),
  async detail(url) {
    sourceId(url);
    const rows = await call("note", ["--", url]);
    return Object.fromEntries(rows.map((row) => [row.field, row.value]));
  },
  comments(url, limit) {
    sourceId(url);
    return call("comments", ["--limit", String(limit), "--", url]);
  },
};
async function bridgeModules() {
  const root = resolve(await realpath(await binary()), "../../..");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (pkg.name !== "@jackwener/opencli" || pkg.version !== "2.0.3")
    throw new Error("Draft adapter requires verified OpenCLI 2.0.3");
  return {
    version: pkg.version,
    ...(await import(pathToFileURL(join(root, "dist/src/browser/bridge.js")))),
    draftDb: await import(
      pathToFileURL(join(root, "clis/xiaohongshu/draft-utils.js"))
    ),
  };
}
export async function doctor({ live = false } = {}) {
  const modules = await bridgeModules();
  const report = {
    node: process.versions.node,
    opencli: modules.version,
    draftAdapter: true,
    connection: "unchecked",
    modelConfigured: Boolean(
      process.env.XHS_MODEL_BASE_URL &&
      process.env.XHS_MODEL_NAME &&
      process.env.XHS_MODEL_API_KEY,
    ),
  };
  if (live) {
    await call("creator-profile");
    report.connection = "creator-profile-readable";
  }
  return report;
}
// Verify creator account in the same browser surface used for draft writing.
async function accountName(page) {
  const result = await page.evaluate(`(async () => {
    const response = await fetch('/api/galaxy/creator/home/personal_info', {credentials:'include'});
    if (!response.ok) throw new Error('Creator account unavailable');
    const result = await response.json();
    return result.data?.name || null;
  })()`);
  return result?.data && typeof result.session === "string"
    ? result.data
    : result;
}
export async function saveBrowserDraft(input, { reconcileOnly = false } = {}) {
  const { BrowserBridge, draftDb } = await bridgeModules();
  const bridge = new BrowserBridge();
  let page;
  try {
    page = await bridge.connect({
      session: "xhs-draft:" + randomUUID(),
      windowMode: "foreground",
      surface: "adapter",
      siteSession: "ephemeral",
    });
    await draftDb.ensureDraftDbPage(page);
    if ((await accountName(page)) !== input.account)
      throw new Error(
        "Creator account name differs from the configured target",
      );
    if (reconcileOnly) {
      const found = findXhsDraft(
        await draftDb.readDraftEntries(page, "image"),
        input.note,
        input.images.length,
        draftDb.encodeDraftKey,
      );
      if (!found) throw new Error("Draft not found; unknown state retained");
      return { ...found, status: "existing" };
    }
    const existing = findXhsDraft(
      await draftDb.readDraftEntries(page, "image"),
      input.note,
      input.images.length,
      draftDb.encodeDraftKey,
    );
    if (existing && !input.previous)
      throw new Error(
        "Similar draft lacks a local manifest; inspect it before adopting",
      );
    return await saveXhsDraftInBrowser(page, draftDb, {
      ...input,
      beforeSave: async () => {
        if ((await accountName(page)) !== input.account)
          throw new Error("Creator account changed before draft save");
        await input.beforeSave();
      },
    });
  } finally {
    await page?.closeWindow().catch(() => {});
    await bridge.close().catch(() => {});
  }
}
