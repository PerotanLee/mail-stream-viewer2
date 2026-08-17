const textCache = new Map<string, string>();
let translatorPromise: Promise<Translator | null> | null = null;

async function getTranslator(): Promise<Translator | null> {
  if (translatorPromise) return translatorPromise;
  translatorPromise = (async () => {
    const api = window.Translator;
    if (!api?.create) return null;
    try {
      if (api.availability) {
        const availability = await api.availability({
          sourceLanguage: "en",
          targetLanguage: "ja",
        });
        if (availability === "unavailable") return null;
      }
      return await api.create({
        sourceLanguage: "en",
        targetLanguage: "ja",
      });
    } catch {
      return null;
    }
  })();
  return translatorPromise;
}

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^https?:\/\//i.test(trimmed) || /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(trimmed)) return true;
  if (/^[\d$%.,:+\-–—•·\s/()[\]#]+$/.test(trimmed)) return true;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\u4e00-\u9fff]/u.test(trimmed)) return true;
  if (!/[A-Za-z]/.test(trimmed)) return true;
  return false;
}

function keepEdges(original: string, translated: string): string {
  const lead = original.match(/^\s*/)?.[0] ?? "";
  const trail = original.match(/\s*$/)?.[0] ?? "";
  return `${lead}${translated.trim()}${trail}`;
}

async function translateViaGoogle(text: string): Promise<string | null> {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=" +
    encodeURIComponent(text);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = (await response.json()) as [string, unknown][][];
    const pieces = payload[0] ?? [];
    const joined = pieces.map((item) => (item && item[0] ? String(item[0]) : "")).join("");
    return joined.trim() || null;
  } catch {
    return null;
  }
}

export async function translateEnJa(text: string): Promise<string | null> {
  const source = text.trim();
  if (!source) return "";
  const hit = textCache.get(source);
  if (hit !== undefined) return hit;
  if (shouldSkip(source)) return source;

  const translator = await getTranslator();
  try {
    if (translator) {
      const translated = (await translator.translate(source)).trim();
      textCache.set(source, translated);
      return translated;
    }
  } catch {
    // fall through to HTTP fallback
  }

  const fallback = await translateViaGoogle(source);
  if (fallback) {
    textCache.set(source, fallback);
    return fallback;
  }
  return null;
}

export async function translateHtmlEnJa(html: string): Promise<string | null> {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent && !skip.has(parent.tagName) && current.textContent && !shouldSkip(current.textContent)) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  if (nodes.length === 0) return html;

  const unique = [...new Set(nodes.map((node) => node.textContent?.trim() || "").filter(Boolean))];
  for (let i = 0; i < unique.length; i += 4) {
    const batch = unique.slice(i, i + 4);
    await Promise.all(
      batch.map(async (text) => {
        if (textCache.has(text)) return;
        const translated = await translateEnJa(text);
        if (translated) textCache.set(text, translated);
      }),
    );
  }

  let changed = false;
  for (const node of nodes) {
    const original = node.textContent ?? "";
    const translated = textCache.get(original.trim());
    if (translated) {
      node.textContent = keepEdges(original, translated);
      changed = true;
    }
  }
  if (!changed) return null;

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  return `${doctype}${doc.documentElement.outerHTML}`;
}
