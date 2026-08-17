import type { AppSettings, Connection, EmailIndex, EmailRecord } from "./types";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function headers(token: string): HeadersInit {
  const result: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    result.Authorization = `Bearer ${token}`;
  }
  return result;
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function encryptSecret(publicKey: string, secret: string): Promise<string> {
  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;
  const binkey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const binsec = sodium.from_string(secret);
  const encBytes = sodium.crypto_box_seal(binsec, binkey);
  return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
}

async function githubFetch(connection: Connection, path: string, init?: RequestInit): Promise<Response> {
  const url = `${API}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers(connection.token),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new GitHubError(response.status, body.slice(0, 300) || response.statusText);
  }
  return response;
}

type ContentFile = {
  sha: string;
  content: string;
};

async function getFile(connection: Connection, path: string): Promise<ContentFile> {
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const res = await githubFetch(
    connection,
    `/repos/${connection.owner}/${connection.repo}/contents/${encoded}?ref=${encodeURIComponent(connection.branch)}`,
  );
  return (await res.json()) as ContentFile;
}

async function putFile(
  connection: Connection,
  path: string,
  message: string,
  text: string,
  sha?: string,
): Promise<void> {
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  await githubFetch(connection, `/repos/${connection.owner}/${connection.repo}/contents/${encoded}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      branch: connection.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function readJsonFile<T>(connection: Connection, path: string): Promise<{ data: T; sha: string }> {
  const file = await getFile(connection, path);
  return { data: JSON.parse(decodeBase64(file.content)) as T, sha: file.sha };
}

export async function writeJsonFile(
  connection: Connection,
  path: string,
  message: string,
  data: unknown,
  sha?: string,
): Promise<void> {
  const text = JSON.stringify(data, null, 2) + "\n";
  await putFile(connection, path, message, text, sha);
}

export async function loadSettings(connection: Connection): Promise<{ settings: AppSettings; sha: string }> {
  const { data, sha } = await readJsonFile<Partial<AppSettings>>(connection, "data/settings.json");
  return {
    sha,
    settings: {
      senderFilter: data.senderFilter ?? "",
      zoom: typeof data.zoom === "number" ? data.zoom : 100,
      displayLang: data.displayLang === "en" ? "en" : "ja",
      pop3Host: data.pop3Host ?? "",
      pop3Port: data.pop3Port ?? "995",
      pop3User: data.pop3User ?? "",
      pop3Ssl: data.pop3Ssl !== false,
    },
  };
}

export async function saveSettings(
  connection: Connection,
  settings: AppSettings,
  sha: string,
): Promise<string> {
  const payload: AppSettings = {
    senderFilter: settings.senderFilter,
    zoom: settings.zoom,
    displayLang: settings.displayLang,
    pop3Host: settings.pop3Host,
    pop3Port: settings.pop3Port,
    pop3User: settings.pop3User,
    pop3Ssl: settings.pop3Ssl,
  };
  await writeJsonFile(connection, "data/settings.json", "Update app settings", payload, sha);
  const latest = await loadSettings(connection);
  return latest.sha;
}

export async function savePop3Secrets(
  connection: Connection,
  settings: AppSettings,
  password: string,
): Promise<void> {
  if (!connection.token) {
    throw new Error("POP3 の保存には GitHub PAT が必要です");
  }
  const secrets: Record<string, string> = {};
  if (settings.pop3Host.trim()) secrets.POP3_HOST = settings.pop3Host.trim();
  if (settings.pop3Port.trim()) secrets.POP3_PORT = settings.pop3Port.trim();
  if (settings.pop3User.trim()) secrets.POP3_USER = settings.pop3User.trim();
  if (settings.pop3Host.trim() || settings.pop3User.trim()) {
    secrets.POP3_SSL = settings.pop3Ssl ? "true" : "false";
  }
  if (password) secrets.POP3_PASSWORD = password;
  if (Object.keys(secrets).length === 0) return;

  const keyRes = await githubFetch(
    connection,
    `/repos/${connection.owner}/${connection.repo}/actions/secrets/public-key`,
  );
  const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };

  for (const [name, value] of Object.entries(secrets)) {
    const encrypted_value = await encryptSecret(key, value);
    await githubFetch(
      connection,
      `/repos/${connection.owner}/${connection.repo}/actions/secrets/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        body: JSON.stringify({ encrypted_value, key_id }),
      },
    );
  }
}

export async function loadIndex(connection: Connection): Promise<{ index: EmailIndex; sha: string }> {
  const { data, sha } = await readJsonFile<EmailIndex>(connection, "data/index.json");
  return {
    sha,
    index: { emails: Array.isArray(data.emails) ? data.emails : [] },
  };
}

export async function saveIndex(connection: Connection, index: EmailIndex, sha: string): Promise<string> {
  await writeJsonFile(connection, "data/index.json", "Update read state", index, sha);
  const latest = await loadIndex(connection);
  return latest.sha;
}

export async function loadEmail(connection: Connection, file: string): Promise<EmailRecord> {
  const { data } = await readJsonFile<EmailRecord>(connection, `data/emails/${file}`);
  return data;
}

export async function triggerFetch(connection: Connection): Promise<void> {
  if (!connection.token) {
    throw new Error("更新するには GitHub PAT を設定してください");
  }
  await githubFetch(
    connection,
    `/repos/${connection.owner}/${connection.repo}/actions/workflows/fetch-mail.yml/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: connection.branch }),
    },
  );
}

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
};

export async function waitForFetchRun(
  connection: Connection,
  startedAt: number,
  onStatus: (message: string) => void,
): Promise<WorkflowRun> {
  const deadline = Date.now() + 8 * 60 * 1000;
  let run: WorkflowRun | undefined;

  while (Date.now() < deadline) {
    const res = await githubFetch(
      connection,
      `/repos/${connection.owner}/${connection.repo}/actions/workflows/fetch-mail.yml/runs?event=workflow_dispatch&per_page=5`,
    );
    const payload = (await res.json()) as { workflow_runs?: WorkflowRun[] };
    const runs = payload.workflow_runs ?? [];
    run = runs.find((item) => new Date(item.created_at).getTime() >= startedAt - 5000);

    if (run) {
      if (run.status === "completed") {
        if (run.conclusion !== "success") {
          throw new Error(`メール取得に失敗しました（${run.conclusion}）`);
        }
        return run;
      }
      onStatus(run.status === "in_progress" ? "取得中…" : "キュー待ち…");
    } else {
      onStatus("ワークフロー起動を待っています…");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("メール取得がタイムアウトしました");
}
