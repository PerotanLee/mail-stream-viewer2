import type { Connection, PageDownPos } from "./types";

const CONNECTION_KEY = "msv2.connection";
const PAGEDOWN_KEY = "msv2.pagedown";

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Connection;
    if (!parsed.owner || !parsed.repo) return null;
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      token: parsed.token || "",
      branch: parsed.branch || "main",
    };
  } catch {
    return null;
  }
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  localStorage.removeItem(CONNECTION_KEY);
}

export function loadPageDownPos(): PageDownPos | null {
  try {
    const raw = localStorage.getItem(PAGEDOWN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PageDownPos;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePageDownPos(pos: PageDownPos): void {
  localStorage.setItem(PAGEDOWN_KEY, JSON.stringify(pos));
}
