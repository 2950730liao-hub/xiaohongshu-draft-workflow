import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, discover, normalize } from "../src/discovery.mjs";
import {
  createJob,
  resume,
  saveDraft,
  validateNote,
} from "../src/workflow.mjs";
import { readJob, writeJob, lock } from "../src/store.mjs";
import { render } from "../src/render.mjs";
const profile = {
  industry: "普拉提",
  verifiedFacts: ["提供零基础普拉提体验课程"],
  maxModelCalls: 2,
};
const source = { title: "第一次普拉提", body: "想了解上课流程" };
const note = {
  title: "第一次体验怎么准备",
  body: "可以先了解课程安排，再根据自己的时间选择体验。",
  tags: ["普拉提"],
  facts: [],
};
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "xhs-flow-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = await createJob(root, source, profile);
  return { root, job };
}
const generate = async () => ({
  note,
  usage: { prompt_tokens: 12 },
  actualCost: null,
});
const imageRenderer = async (_, dir) => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "01.png");
  await writeFile(file, "controlled image");
  return [file];
};
test("客户意图与同行线索，缺少评论保留证据不足", () => {
  const base = { likes: 10, saves: null, publishedAt: null };
  const customer = assess(
    { ...base, title: "普拉提多少钱，第一次体验", body: "" },
    profile,
  );
  const peer = assess(
    { ...base, title: "普拉提教培考证编排", body: "" },
    profile,
  );
  assert.ok(customer.score > peer.score);
  assert.equal(customer.evidence.commentsRead, false);
  assert.equal(peer.classification, "peer-or-uncertain");
  assert.equal(
    assess({ ...base, title: "记录", body: "" }, profile).classification,
    "insufficient-evidence",
  );
});
test("多词结果按笔记ID去重，评论失败不编造客户信号", async () => {
  const url = "https://www.xiaohongshu.com/explore/synthetic";
  const result = await discover(
    {
      search: async () => [{ title: "普拉提体验", url }],
      detail: async () => ({ content: "第一次上课" }),
      comments: async () => {
        throw new Error("unavailable");
      },
    },
    { ...profile, queries: ["普拉提", "第一次"] },
    { wait: async () => {} },
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].queries.length, 2);
  assert.equal(result.items[0].assessment.evidence.commentsRead, false);
  assert.equal(result.errors.length, 1);
  assert.equal(normalize({ title: "sample", url }).likes, null);
});
test("文案失败时不渲染图片，模型调用上限生效", async (t) => {
  const { root, job } = await setup(t);
  let renders = 0;
  const invalid = async () => ({ note: { ...note, body: "费用9999元" } });
  await assert.rejects(
    resume(root, job.id, {
      generate: invalid,
      renderImages: async () => {
        renders++;
      },
    }),
  );
  assert.equal(renders, 0);
  await assert.rejects(
    resume(root, job.id, { generate: invalid, retryModel: true }),
  );
  await assert.rejects(
    resume(root, job.id, { generate, retryModel: true }),
    /budget exhausted/,
  );
});
test("图片失败后续作保留文案、用量和版本，重启读取一致", async (t) => {
  const { root, job } = await setup(t);
  let calls = 0;
  await assert.rejects(
    resume(root, job.id, {
      generate: async () => {
        calls++;
        return generate();
      },
      renderImages: async () => {
        throw new Error("disk full");
      },
    }),
    /rendering failed/,
  );
  const recovered = await resume(root, job.id, {
    generate: assert.fail,
    renderImages: imageRenderer,
  });
  assert.equal(calls, 1);
  assert.equal(recovered.state, "ready");
  assert.equal(
    (await readJob(root, job.id)).modelAttempts[0].usage.prompt_tokens,
    12,
  );
});
test("模型未知结果和崩溃中断均先阻断重试", async (t) => {
  const { root, job } = await setup(t);
  await assert.rejects(
    resume(root, job.id, {
      generate: async () => {
        throw new Error("timeout");
      },
    }),
  );
  await assert.rejects(
    resume(root, job.id, { generate: assert.fail }),
    /outcome unknown/,
  );
  job.state = "model-running";
  await writeJob(root, job);
  await assert.rejects(resume(root, job.id), /outcome unknown/);
  assert.equal((await readJob(root, job.id)).state, "model-unknown");
});
test("草稿未知先对账，账号变动与图片篡改阻断写入", async (t) => {
  const { root, job } = await setup(t);
  await resume(root, job.id, { generate, renderImages: imageRenderer });
  const options = { account: "Synthetic account", browserProfile: "synthetic" };
  await assert.rejects(
    saveDraft(root, job.id, {
      ...options,
      save: async (input) => {
        await input.beforeSave();
        throw new Error("readback lost");
      },
    }),
  );
  await assert.rejects(
    saveDraft(root, job.id, { ...options, save: assert.fail }),
    /outcome unknown/,
  );
  const saved = await saveDraft(root, job.id, {
    ...options,
    reconcileOnly: true,
    save: async () => ({ status: "existing", draftId: "s:synthetic" }),
  });
  assert.equal(saved.receipt.imageContentVerified, false);
  await assert.rejects(
    saveDraft(root, job.id, {
      ...options,
      account: "Other",
      save: assert.fail,
    }),
    /differs/,
  );
  await writeFile(saved.images[0], "changed");
  await assert.rejects(
    saveDraft(root, job.id, { ...options, save: assert.fail }),
    /images changed/,
  );
});
test("进程锁防并发，异常释放锁", async (t) => {
  const { root } = await setup(t);
  await lock(root, "same", async () => {
    await assert.rejects(lock(root, "same", assert.fail), /locked/);
  });
  await assert.rejects(
    lock(root, "same", async () => {
      throw new Error("test");
    }),
  );
  await lock(root, "same", async () => {});
});
test("本地渲染输出真实PNG，事实和标题校验生效", async (t) => {
  const { root } = await setup(t);
  const images = await render(note, join(root, "render"));
  const bytes = await readFile(images[0]);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.throws(() =>
    validateNote({ ...note, title: "太长".repeat(20) }, profile),
  );
  assert.throws(() =>
    validateNote(
      { ...note, facts: [{ text: "编造", evidence: "不存在的内容" }] },
      profile,
    ),
  );
});

test("列表编号与已验证条目数可用，效果数字继续需要来源", () => {
  const numbered = {
    ...note,
    title: "先问这2项",
    body: "1. 问课型\n2. 问安排",
  };
  assert.equal(validateNote(numbered, profile).title, numbered.title);
  assert.throws(() =>
    validateNote({ ...numbered, title: "先问这9项" }, profile),
  );
  assert.throws(() =>
    validateNote({ ...note, body: "练习30天保证瘦" }, profile),
  );
});

test("已保存的模型候选可以在校验修复后复用，避免重复付费", async (t) => {
  const { root, job } = await setup(t);
  job.candidate = note;
  job.state = "copy-failed";
  await writeJob(root, job);
  const result = await resume(root, job.id, {
    generate: assert.fail,
    renderImages: imageRenderer,
  });
  assert.equal(result.state, "ready");
  assert.equal(result.modelAttempts.length, 0);
});
