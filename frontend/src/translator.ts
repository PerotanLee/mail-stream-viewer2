const cache = new Map<string, string>();

export async function translateEnJa(text: string): Promise<string | null> {
  const source = text.trim();
  if (!source) return "";
  const hit = cache.get(source);
  if (hit !== undefined) return hit;

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
    const translator = await api.create({
      sourceLanguage: "en",
      targetLanguage: "ja",
    });
    const translated = (await translator.translate(source)).trim();
    cache.set(source, translated);
    return translated;
  } catch {
    return null;
  }
}
