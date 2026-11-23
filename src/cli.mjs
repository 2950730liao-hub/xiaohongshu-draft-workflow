#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { doctor, adapter } from "./opencli.mjs";
import { discover } from "./discovery.mjs";
import { createJob, resume, saveDraft } from "./workflow.mjs";
import { dataRoot, readJob } from "./store.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: "string" },
    source: { type: "string" },
    id: { type: "string" },
    account: { type: "string" },
    "browser-profile": { type: "string" },
    limit: { type: "string", default: "10" },
    inspect: { type: "string", default: "5" },
    live: { type: "boolean", default: false },
    "retry-model": { type: "boolean", default: false },
  },
});
const root = dataRoot();
const jsonFile = async (file) => {
  if (!file) throw new Error("Required JSON file argument missing");
  return JSON.parse(await readFile(resolve(file), "utf8"));
};
function bounded(value, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum)
    throw new Error(`Expected integer between 1 and ${maximum}`);
  return number;
}
async function main() {
  switch (positionals[0]) {
    case "doctor":
      return doctor({ live: values.live });
    case "search": {
      const result = await discover(adapter, await jsonFile(values.profile), {
        limit: bounded(values.limit, 50),
        inspect: bounded(values.inspect, 20),
      });
      await mkdir(join(root, "searches"), { recursive: true, mode: 0o700 });
      const path = join(root, "searches", randomUUID() + ".json");
      await writeFile(path, JSON.stringify(result, null, 2), { mode: 0o600 });
      return { path, ...result };
    }
    case "inspect":
      return adapter.detail(values.source);
    case "create": {
      const job = await createJob(
        root,
        await jsonFile(values.source),
        await jsonFile(values.profile),
      );
      return resume(root, job.id);
    }
    case "resume":
      return resume(root, values.id, { retryModel: values["retry-model"] });
    case "status":
      return readJob(root, values.id);
    case "save-draft":
    case "reconcile":
      return saveDraft(root, values.id, {
        account: values.account,
        browserProfile: values["browser-profile"],
        reconcileOnly: positionals[0] === "reconcile",
      });
    default:
      return {
        commands: [
          "doctor [--live]",
          "search --profile profile.json [--limit 10 --inspect 5]",
          "inspect --source FULL_NOTE_URL",
          "create --profile profile.json --source source.json",
          "status --id UUID",
          "resume --id UUID [--retry-model]",
          "save-draft --id UUID --account NAME --browser-profile LABEL",
          "reconcile --id UUID --account NAME --browser-profile LABEL",
        ],
      };
  }
}
try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  // Avoid printing SDK responses, child-process output or environment values.
  const message = String(error.message || "Operation failed");
  const keys = [process.env.XHS_MODEL_API_KEY].filter(Boolean);
  let safe = message;
  for (const key of keys) safe = safe.replaceAll(key, "[REDACTED]");
  console.error(JSON.stringify({ error: safe }));
  process.exitCode = 1;
}
