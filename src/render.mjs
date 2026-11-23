import sharp from "sharp";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
function rows(text, size) {
  const output = [];
  for (const paragraph of text.split("\n")) {
    const chars = [...paragraph];
    if (!chars.length) output.push("");
    while (chars.length) output.push(chars.splice(0, size).join(""));
  }
  return output;
}
export async function render(note, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const lines = rows(note.body, 23);
  const pages = [];
  for (let offset = 0; offset < lines.length; offset += 17)
    pages.push(lines.slice(offset, offset + 17));
  const images = [];
  for (const [index, page] of pages.entries()) {
    const title = rows(note.title, 13)
      .map(
        (line, row) =>
          `<text x="90" y="${150 + row * 90}" font-size="72" font-weight="bold">${escape(line)}</text>`,
      )
      .join("");
    const content = page
      .map(
        (line, row) =>
          `<text x="90" y="${400 + row * 62}" font-size="44">${escape(line)}</text>`,
      )
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1242" height="1660"><rect width="1242" height="1660" fill="#f6f3ec"/><g font-family="sans-serif" fill="#263c34">${title}${content}<text x="90" y="1570" font-size="26">${index + 1} / ${pages.length}</text></g></svg>`;
    const path = join(destination, String(index + 1).padStart(2, "0") + ".png");
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path + ".tmp");
    await rename(path + ".tmp", path);
    images.push(path);
  }
  return images;
}
