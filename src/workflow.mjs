import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, lock, readJob, writeJob } from "./store.mjs";
import { rewrite } from "./model.mjs";
import { render } from "./render.mjs";
import { saveBrowserDraft } from "./opencli.mjs";

export function validateNote(note, profile, source = {}) {
  if (
    typeof note?.title !== "string" ||
    !note.title.trim() ||
    [...note.title].length > 20
  )
    throw new Error("Title must contain 1–20 characters");
  if (
    typeof note.body !== "string" ||
    !note.body.trim() ||
    [...note.body].length > 900
  )
    throw new Error("Body must contain 1–900 characters");
  if (
    !Array.isArray(note.tags) ||
    note.tags.length > 8 ||
    note.tags.some(
      (tag) =>
        typeof tag !== "string" ||
        !tag ||
        [...tag].length > 24 ||
        /[\s#]/.test(tag),
    )
  )
    throw new Error("Invalid tags");
  const text = note.body + "\n\n" + note.tags.map((tag) => "#" + tag).join(" ");
  if ([...text].length > 1000)
    throw new Error("Body and tags exceed the adapter limit");
  if (!Array.isArray(note.facts))
    throw new Error("Model must provide fact evidence");
  const business = JSON.stringify(profile);
  for (const fact of note.facts) {
    if (
      typeof fact.text !== "string" ||
      typeof fact.evidence !== "string" ||
      fact.evidence.length < 4 ||
      !business.includes(fact.evidence)
    )
      throw new Error("A claimed business fact lacks evidence");
  }
  if (note.title === source.title || note.body === source.body)
    throw new Error("Output repeats the source");
  const listCount = [...note.body.matchAll(/^\s*\d+[.、．)]\s*/gm)].length;
  const titleForNumbers = note.title.replace(
    /(\d+)(项|件事|个问题|个准备)/g,
    (match, count, unit) =>
      Number(count) === listCount && listCount > 0 ? unit : match,
  );
  const bodyForNumbers = note.body.replace(/^\s*\d+[.、．)]\s*/gm, "");
  const suppliedNumbers = new Set(business.match(/\d+(?:\.\d+)?/g) || []);
  const invented =
    (titleForNumbers + bodyForNumbers)
      .match(/\d+(?:\.\d+)?/g)
      ?.filter((number) => !suppliedNumbers.has(number)) || [];
  if (invented.length)
    throw new Error("Output contains numbers absent from the business profile");
  if (/保证|包瘦|治愈|根治|百分百|100%/.test(note.title + note.body))
    throw new Error("Unsupported outcome promise");
  return {
    title: note.title.trim(),
    body: note.body.trim(),
    tags: note.tags,
    facts: note.facts,
  };
}
export async function createJob(root, source, profile) {
  if (
    !profile.industry ||
    !Array.isArray(profile.verifiedFacts) ||
    !profile.verifiedFacts.length
  )
    throw new Error("Supply industry and verifiedFacts before creation");
  if (!source?.title || !source?.body)
    throw new Error("Full source title and body required");
  const job = {
    schemaVersion: 1,
    id: randomUUID(),
    revision: 1,
    createdAt: new Date().toISOString(),
    state: "pending",
    source,
    profile,
    modelAttempts: [],
    note: null,
    images: [],
    receipt: null,
  };
  await writeJob(root, job);
  return job;
}
export async function resume(
  root,
  id,
  { generate = rewrite, renderImages = render, retryModel = false } = {},
) {
  return lock(root, "job:" + id, async () => {
    const job = await readJob(root, id);
    if (job.state === "model-running") {
      job.state = "model-unknown";
      await writeJob(root, job);
    }
    if (job.state === "model-unknown" && !retryModel)
      throw new Error(
        "Model outcome unknown. Inspect supplier usage before --retry-model (may charge again).",
      );
    if (!job.note && job.candidate && !retryModel) {
      job.note = validateNote(job.candidate, job.profile, job.source);
      job.state = "render-pending";
      await writeJob(root, job);
    }
    if (!job.note) {
      const maximum = Number(job.profile.maxModelCalls ?? 1);
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5)
        throw new Error("maxModelCalls must be 1–5");
      if (job.modelAttempts.length >= maximum)
        throw new Error(
          "Model call budget exhausted; inspect usage and explicitly increase profile.maxModelCalls in the local job to continue",
        );
      job.state = "model-running";
      const attempt = {
        at: new Date().toISOString(),
        state: "unknown",
        actualCost: null,
      };
      job.modelAttempts.push(attempt);
      await writeJob(root, job);
      try {
        const output = await generate(job.source, job.profile);
        job.candidate = output.note;
        Object.assign(attempt, {
          state: "completed",
          usage: output.usage,
          requestId: output.requestId,
          actualCost: output.actualCost,
          model: output.model,
        });
        job.note = validateNote(output.note, job.profile, job.source);
        job.state = "render-pending";
        await writeJob(root, job);
      } catch (error) {
        const completed = attempt.state === "completed";
        job.state =
          completed || error.definite ? "copy-failed" : "model-unknown";
        if (error.usage) attempt.usage = error.usage;
        attempt.state = job.state;
        job.error =
          job.state === "model-unknown"
            ? "Model outcome unknown; inspect supplier usage"
            : "Copy invalid or request rejected; review input";
        if (
          completed ||
          /^(Model HTTP|Model returned invalid JSON)/.test(error.message)
        )
          job.error += ": " + error.message;
        await writeJob(root, job);
        throw new Error(job.error + "; job id " + job.id);
      }
    }
    if (!job.images.length) {
      try {
        job.images = await renderImages(
          job.note,
          join(root, "assets", id, "v" + job.revision),
        );
        job.imageHashes = await Promise.all(
          job.images.map(async (file) => hash(await readFile(file))),
        );
        job.state = "ready";
        delete job.error;
        await writeJob(root, job);
      } catch {
        job.state = "render-failed";
        await writeJob(root, job);
        throw new Error(
          "Image rendering failed; resume retains completed copy",
        );
      }
    }
    return job;
  });
}
export async function saveDraft(
  root,
  id,
  {
    account,
    browserProfile,
    reconcileOnly = false,
    save = saveBrowserDraft,
  } = {},
) {
  if (!account || !browserProfile)
    throw new Error(
      "Supply target --account and a stable --browser-profile label",
    );
  return lock(root, "browser-write", () =>
    lock(root, "job:" + id, async () => {
      const job = await readJob(root, id);
      if (reconcileOnly && !job.draftIntent)
        throw new Error("No saved draft intent to reconcile");
      if (!job.note || !job.images.length)
        throw new Error("Create complete copy and images first");
      const actualHashes = await Promise.all(
        job.images.map(async (file) => hash(await readFile(file))),
      );
      if (JSON.stringify(actualHashes) !== JSON.stringify(job.imageHashes))
        throw new Error(
          "Local images changed; recreate or restore this version",
        );
      const manifest = hash(
        JSON.stringify({
          account,
          browserProfile,
          revision: job.revision,
          note: job.note,
          images: actualHashes,
        }),
      );
      if (job.draftIntent && job.draftIntent.manifest !== manifest)
        throw new Error(
          "Account, browser profile or content differs from draft intent",
        );
      if (job.state === "draft-unknown" && !reconcileOnly)
        throw new Error("Draft outcome unknown. Run reconcile first.");
      const previous = job.draftIntent;
      const result = await save(
        {
          account,
          note: job.note,
          images: job.images,
          previous,
          beforeSave: async () => {
            job.state = "draft-unknown";
            job.draftIntent = {
              manifest,
              account,
              browserProfile,
              revision: job.revision,
              at: new Date().toISOString(),
            };
            await writeJob(root, job);
          },
        },
        { reconcileOnly },
      );
      if (!["saved", "existing"].includes(result?.status) || !result.draftId)
        throw new Error("Draft receipt unavailable");
      job.receipt = {
        ...result,
        at: new Date().toISOString(),
        account,
        browserProfile,
        revision: job.revision,
        manifest,
        verification: "browser-local-text-image-count-ai-declaration",
        imageContentVerified: false,
        crossDeviceVerified: false,
      };
      job.state = "draft-saved";
      await writeJob(root, job);
      return job;
    }),
  );
}
