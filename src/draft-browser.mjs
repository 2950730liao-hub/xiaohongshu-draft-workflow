import { setTimeout as delay } from "node:timers/promises";
const creatorOrigin = "https://creator.xiaohongshu.com";
const aiDeclaration = "笔记含AI合成内容";
const normalized = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export function xhsDraftText(note) {
  const topics = note.tags.map((tag) => "#" + tag.replace(/^#/, "")).join(" ");
  return [note.body, topics].filter(Boolean).join("\n\n");
}

export function findXhsDraft(entries, note, imageCount, encodeKey) {
  const matches = entries.filter(({ row }) => {
    const { title, desc } = row?.content?.draftStore ?? {};
    return (
      normalized(title) === normalized(note.title) ||
      normalized(desc) === normalized(xhsDraftText(note))
    );
  });
  if (!matches.length) return null;
  const [{ key, row }] = matches;
  if (
    matches.length !== 1 ||
    key == null ||
    normalized(row.content.draftStore.title) !== normalized(note.title) ||
    normalized(row.content.draftStore.desc) !==
      normalized(xhsDraftText(note)) ||
    row.content.draftStore.imgList?.length !== imageCount ||
    row.content.settingStore?.userDeclaration?.origin !== 2
  )
    throw new Error(
      "草稿箱已有相似笔记，内容、配图数量或 AI 声明无法核对。请在 Chrome 草稿箱检查。",
    );
  return { draftId: encodeKey(key), imageCount };
}

async function until(read, message, timeout = 20000) {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await delay(500);
  } while (Date.now() < end);
  throw new Error(message);
}

function evaluate(page, fn, input = null) {
  return page.evaluate(`(${fn})(${JSON.stringify(input)})`);
}

// The old publish adapter is intentionally absent from this flow. The only
// composer action is the creator panel's "暂存离开" handler.
export async function saveXhsDraftInBrowser(
  page,
  draftDb,
  { note, images, previous, beforeSave },
) {
  await draftDb.ensureDraftDbPage(page);
  await until(
    () =>
      evaluate(
        page,
        (origin) => {
          if (
            location.origin !== origin ||
            /安全验证|扫码登录/.test(document.body?.innerText ?? "")
          )
            throw new Error(
              "请在连接的 Chrome 完成小红书创作平台登录或安全验证。",
            );
          return document.body?.innerText.includes("草稿箱");
        },
        creatorOrigin,
      ),
    "小红书创作平台草稿箱未加载。",
  );

  const entries = await draftDb.readDraftEntries(page, "image");
  const findDraft = (rows) =>
    findXhsDraft(rows, note, images.length, draftDb.encodeDraftKey);
  const existing = findDraft(entries);
  if (existing) return { ...existing, status: "existing" };
  if (previous)
    throw new Error(
      "有本机交接记录，当前 Chrome 未找到相同草稿。请核对原草稿或浏览器配置，避免重建。",
    );
  if (entries.length >= 100)
    throw new Error("小红书草稿箱已满，请腾出空间后再存。");

  const inputSelector =
    'input[type="file"][accept*="image"],input[type="file"][accept*=".png"],input[type="file"][accept*=".jpg"],input[type="file"][accept*=".jpeg"],input[type="file"][accept*=".webp"]';
  await until(
    () =>
      evaluate(
        page,
        (selector) => Boolean(document.querySelector(selector)),
        inputSelector,
      ),
    "图文编辑器未提供图片上传入口。",
  );
  // Uploading can trigger platform autosave, so record intent before mutation.
  await beforeSave();
  await page.setFileInput(images, inputSelector);
  await until(
    () =>
      evaluate(
        page,
        ({ count }) => {
          const media = [...document.querySelectorAll("button")].filter(
            (button) =>
              button.getClientRects().length &&
              button.innerText.trim() === "编辑",
          );
          return (
            media.length === count &&
            Boolean(document.querySelector('.tiptap[contenteditable="true"]'))
          );
        },
        { count: images.length },
      ),
    "图片未全部进入编辑器，尚未暂存。",
  );
  const body = xhsDraftText(note);
  const filled = await evaluate(
    page,
    ({ title, body }) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      const editor = document.querySelector('.tiptap[contenteditable="true"]');
      if (!input || !editor) return false;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, title);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      editor.focus();
      if (!document.execCommand("insertText", false, body)) return false;
      editor.blur();
      const normalize = (value) => value.replace(/\s+/g, " ").trim();
      return (
        input.value === title && normalize(editor.innerText) === normalize(body)
      );
    },
    { title: note.title, body },
  );
  if (!filled) throw new Error("标题、正文和话题未能完整带入，尚未暂存。");

  const openDeclaration = await evaluate(page, () => {
    const menu = [...document.querySelectorAll(".d-select")].find(
      (el) => el.innerText.trim() === "添加内容类型声明",
    );
    if (!menu) return false;
    menu.setAttribute("data-xhs-declaration", "true");
    menu.scrollIntoView?.({ block: "center", behavior: "instant" });
    return true;
  });
  if (!openDeclaration)
    throw new Error("找不到平台的内容类型声明入口，尚未暂存。");
  await page.click("[data-xhs-declaration] .d-select-main");
  await until(
    () =>
      evaluate(
        page,
        (label) => {
          const options = [...document.querySelectorAll("body *")];
          const option = options.find(
            (el) =>
              el.children.length === 0 &&
              el.innerText?.trim() === label &&
              el.getClientRects().length,
          );
          if (!option) return false;
          option.setAttribute("data-xhs-ai-option", "true");
          option.scrollIntoView?.({ block: "center", behavior: "instant" });
          return true;
        },
        aiDeclaration,
      ),
    "平台未提供 AI 合成内容声明，尚未暂存。",
    5000,
  );
  await page.click("[data-xhs-ai-option]");
  await until(
    () =>
      evaluate(
        page,
        (label) =>
          [...document.querySelectorAll(".d-select")].some(
            (el) => el.innerText.trim() === label,
          ),
        aiDeclaration,
      ),
    "AI 内容声明未成功选中，尚未暂存。",
    5000,
  );

  await beforeSave();
  const saved = await evaluate(
    page,
    (origin) => {
      if (location.origin !== origin) return false;
      const button = [
        ...document.querySelectorAll('button,[role="button"]'),
      ].find(
        (el) =>
          el.innerText?.trim() === "暂存离开" &&
          el.getClientRects().length &&
          !el.disabled,
      );
      if (button) {
        button.click();
        return true;
      }
      // Creator Center hosts the same control inside a closed shadow root.
      const host = document.querySelector("xhs-publish-btn");
      const save = ["_onSave", "_onSaveDraft", "_onDraft"].find(
        (method) => typeof host?.[method] === "function",
      );
      if (!save) return false;
      host[save]();
      return true;
    },
    creatorOrigin,
  );
  if (!saved) throw new Error("未找到暂存离开操作，请在 Chrome 核对草稿箱。");
  const receipt = await until(
    async () => findDraft(await draftDb.readDraftEntries(page, "image")),
    "未能回读草稿。请先在 Chrome 草稿箱核对，避免重复新建。",
  );
  return { ...receipt, status: "saved" };
}
