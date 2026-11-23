const customerTerms =
  /多少钱|价格|体验|预约|地址|哪里|哪家|私教还是|小班|第一次|零基础|跟不上|晚课|地铁/g;
const peerTerms = /教培|考证|招生|教练培训|排课|编排|引流|获客|开馆|馆主|口令/g;
const matches = (text, expression) => [
  ...new Set(text.match(expression) || []),
];
export function parseCount(value) {
  if (value == null || value === "") return null;
  const text = String(value).replaceAll(",", "");
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return null;
  return number * (/万|w/i.test(text) ? 10000 : /千|k/i.test(text) ? 1000 : 1);
}
export function sourceId(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["www.xiaohongshu.com", "xiaohongshu.com"].includes(parsed.hostname)
  )
    throw new Error("Expected an HTTPS Xiaohongshu note URL");
  const id = parsed.pathname.match(
    /^\/(?:explore|search_result|note)\/([a-z\d_-]+)\/?$/i,
  )?.[1];
  if (!id) throw new Error("Expected a full note URL from search results");
  return id;
}
export function normalize(row) {
  return {
    id: sourceId(row.url),
    url: row.url,
    title: String(row.title || ""),
    body: String(row.content || row.desc || row.body || ""),
    author: String(row.author || row.nickname || ""),
    likes: parseCount(row.likes ?? row.liked_count),
    saves: parseCount(row.collects ?? row.collected_count),
    commentsCount: parseCount(row.comments ?? row.comment_count),
    publishedAt: row.published_at || null,
  };
}
export function assess(note, profile, comments = null) {
  const text = note.title + "\n" + note.body;
  const evidence =
    comments === null
      ? null
      : comments.map((row) => String(row.content || row.text || "")).join("\n");
  const customerSignals = matches(text, customerTerms);
  const commentSignals =
    evidence === null ? [] : matches(evidence, customerTerms);
  const peerSignals = matches(text, peerTerms);
  const terms = [
    profile.industry,
    profile.city,
    profile.area,
    ...(profile.customerNeeds || []),
  ].filter(Boolean);
  const matched = terms.filter((term) => text.includes(term));
  const customer = Math.min(
    100,
    customerSignals.length * 18 + commentSignals.length * 22,
  );
  const relevance = terms.length
    ? Math.round((100 * matched.length) / terms.length)
    : 0;
  const interaction = Math.min(
    100,
    Math.log10(1 + (note.likes || 0) + 2 * (note.saves || 0)) * 20,
  );
  const peerPenalty = Math.min(45, peerSignals.length * 15);
  return {
    score: Math.max(
      0,
      Math.round(
        customer * 0.55 + relevance * 0.35 + interaction * 0.1 - peerPenalty,
      ),
    ),
    classification:
      peerSignals.length && !commentSignals.length
        ? "peer-or-uncertain"
        : customerSignals.length || commentSignals.length
          ? "customer-relevant"
          : "insufficient-evidence",
    customerSignals,
    commentSignals,
    peerSignals,
    matched,
    evidence: {
      commentsRead: comments !== null,
      publishedAt: note.publishedAt,
      interactionComplete: note.likes !== null && note.saves !== null,
    },
  };
}
export function queriesFor(profile) {
  if (!profile.industry) throw new Error("profile.industry is required");
  if (profile.queries?.length) return [...new Set(profile.queries)];
  const location = [profile.city, profile.area].filter(Boolean).join(" ");
  return [
    `${location} ${profile.industry} 体验课`,
    `第一次${profile.industry}感受`,
    `${profile.industry} 私教还是小班`,
    `${location} ${profile.industry} 多少钱`,
  ].map((q) => q.trim());
}
export async function discover(
  adapter,
  profile,
  {
    limit = 10,
    inspect = 5,
    wait = () => new Promise((resolve) => setTimeout(resolve, 2500)),
  } = {},
) {
  const notes = new Map();
  const errors = [];
  for (const query of queriesFor(profile)) {
    for (const row of await adapter.search(query, limit)) {
      try {
        const note = normalize(row);
        if (!notes.has(note.id))
          notes.set(note.id, { ...note, queries: [query] });
        else notes.get(note.id).queries.push(query);
      } catch {
        errors.push({
          phase: "normalize",
          message: "Invalid note metadata omitted",
        });
      }
    }
    await wait();
  }
  let items = [...notes.values()].map((note) => ({
    ...note,
    assessment: assess(note, profile),
  }));
  items.sort((a, b) => b.assessment.score - a.assessment.score);
  for (const item of items.slice(0, inspect)) {
    try {
      const detail = await adapter.detail(item.url);
      Object.assign(item, normalize({ ...item, ...detail, url: item.url }));
      await wait();
      let comments = null;
      try {
        comments = await adapter.comments(item.url, 20);
      } catch {
        errors.push({
          id: item.id,
          phase: "comments",
          message: "Comments unavailable; intention evidence incomplete",
        });
      }
      item.assessment = assess(item, profile, comments);
    } catch {
      errors.push({
        id: item.id,
        phase: "detail",
        message: "Detail unavailable; search preview retained",
      });
    }
    await wait();
  }
  return {
    at: new Date().toISOString(),
    queries: queriesFor(profile),
    items: items.sort((a, b) => b.assessment.score - a.assessment.score),
    errors,
  };
}
