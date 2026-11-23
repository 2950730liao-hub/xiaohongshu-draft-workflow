import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { saveXhsDraftInBrowser, xhsDraftText } from "../src/draft-browser.mjs";

const note = {
  title: "两笔建模单",
  body: "第一段\n\n第二段",
  tags: ["AI工具", "复盘"],
};
const images = ["/tmp/01.png", "/tmp/02.png"];
const record = (origin = 2) => ({
  key: "draft-1",
  row: {
    content: {
      draftStore: {
        title: note.title,
        desc: xhsDraftText(note).replaceAll("\n\n", "\n\t\n"),
        imgList: images,
      },
      settingStore: { userDeclaration: { origin } },
    },
  },
});

function draftDb(getEntries) {
  return {
    ensureDraftDbPage: async () => {},
    encodeDraftKey: (key) => "s:" + key,
    readDraftEntries: async () => getEntries(),
  };
}

const input = (extra = {}) => ({
  note,
  images,
  beforeSave: assert.fail,
  ...extra,
});

test("按标题、正文和话题、配图数与 AI 声明复用已有草稿，冲突时停下", async () => {
  const page = { evaluate: async () => true, setFileInput: assert.fail };
  assert.deepEqual(
    await saveXhsDraftInBrowser(
      page,
      draftDb(() => [record()]),
      input(),
    ),
    {
      draftId: "s:draft-1",
      imageCount: 2,
      status: "existing",
    },
  );
  await assert.rejects(
    saveXhsDraftInBrowser(
      page,
      draftDb(() => [record(0)]),
      input(),
    ),
    /已有相似笔记/,
  );
  await assert.rejects(
    saveXhsDraftInBrowser(
      page,
      draftDb(() => []),
      input({ previous: { status: "unknown" } }),
    ),
    /避免重建/,
  );
});

test("新稿按序上传，带入话题并选 AI 声明，只触发暂存并回读新草稿", async () => {
  const dom = new JSDOM(
    '<div>草稿箱(0)</div><input type="file" accept=".jpg,.jpeg,.png,.webp" multiple>',
    {
      url: "https://creator.xiaohongshu.com/publish/publish",
      runScripts: "outside-only",
    },
  );
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
    set(value) {
      this.textContent = value;
    },
  });
  window.HTMLElement.prototype.getClientRects = () => [{ width: 10 }];
  document.execCommand = (operation, _, text) => {
    assert.equal(operation, "insertText");
    document.querySelector(".tiptap").innerText = text;
    return true;
  };
  let saved, intentRecorded;
  const page = {
    evaluate: async (script) => window.eval(script),
    click: async (selector) => {
      const element = document.querySelector(selector);
      assert.ok(element);
      element.click();
    },
    setFileInput: async (files) => {
      assert.ok(
        intentRecorded,
        "Intent must precede upload and platform autosave",
      );
      assert.deepEqual(files, images);
      document.body.insertAdjacentHTML(
        "beforeend",
        `
        <button>编辑</button><button>编辑</button><input placeholder="填写标题">
        <div class="tiptap" contenteditable="true"></div>
        <div class="d-select"><div class="d-select-main">添加内容类型声明</div></div>
        <xhs-publish-btn></xhs-publish-btn><button id="publish">发布</button>`,
      );
      document.querySelector("#publish").onclick = assert.fail;
      document.querySelector(".d-select").onclick = () => {
        const option = document.createElement("button");
        option.textContent = "笔记含AI合成内容";
        option.onclick = () => {
          document.querySelector(".d-select-main").textContent =
            option.textContent;
          option.remove();
        };
        document.body.appendChild(option);
      };
      const host = document.querySelector("xhs-publish-btn");
      host._onPublish = assert.fail;
      host._onSave = () => {
        assert.ok(intentRecorded);
        assert.equal(
          document.querySelector(".d-select-main").textContent,
          "笔记含AI合成内容",
        );
        assert.equal(
          document.querySelector("input[placeholder]").value,
          note.title,
        );
        assert.equal(
          document.querySelector(".tiptap").textContent,
          xhsDraftText(note),
        );
        saved = record();
      };
    },
  };
  assert.deepEqual(
    await saveXhsDraftInBrowser(
      page,
      draftDb(() => (saved ? [saved] : [])),
      input({
        beforeSave: () => {
          intentRecorded = true;
        },
      }),
    ),
    { draftId: "s:draft-1", imageCount: 2, status: "saved" },
  );
});
