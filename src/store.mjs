import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const dataRoot = () => resolve(process.env.XHS_DATA_DIR || ".data");
export function jobPath(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid job id");
  return join(root, "jobs", id + ".json");
}
export async function readJob(root, id) {
  return JSON.parse(await readFile(jobPath(root, id), "utf8"));
}
export async function writeJob(root, job) {
  await mkdir(join(root, "jobs"), { recursive: true, mode: 0o700 });
  const file = jobPath(root, job.id);
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(job, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
export async function lock(root, name, action) {
  await mkdir(join(root, "locks"), { recursive: true, mode: 0o700 });
  const file = join(root, "locks", hash(name) + ".lock");
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Operation locked. Check active process before removing a stale lock.",
      );
    throw error;
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    return await action();
  } finally {
    await handle.close();
    await unlink(file);
  }
}
