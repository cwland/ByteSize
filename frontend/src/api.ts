// Small fetch wrapper. The login token lives in localStorage on this device.

const TOKEN_KEY = "bytesize.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: stays signed in only for this page load */
  }
}

export class ApiError extends Error {
  // body: the server's whole answer, for the few that carry more than { error } (a restore: { restored: true })
  constructor(public status: number, message: string, public details?: { path: string; message: string }[], public body?: Record<string, unknown>) {
    super(message);
  }
}

// This browser's own random id, kept in localStorage: signing in again here reuses the same row in
// Settings › Security › Signed-in devices instead of adding one per sign-in
let memoryDeviceId: string | null = null;
function deviceId() {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    let id = localStorage.getItem("bytesize-device-id");
    if (!id) {
      id = make();
      localStorage.setItem("bytesize-device-id", id);
    }
    return id;
  } catch {
    return (memoryDeviceId ??= make());
  }
}

// The server's first field-level message reads better than "Invalid request"
const errorText = (data: { error?: string; details?: { message: string }[] }, status: number) =>
  data.error === "Invalid request" && data.details?.[0]?.message ? data.details[0].message : (data.error ?? `Request failed (${status})`);

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-device-id": deviceId() };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  // A form upload (photos) goes as is: the browser sets the multipart content-type with its boundary
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  } catch {
    // offline, server restarting, Wi-Fi dropped: the browser only says "Failed to fetch"
    throw new ApiError(0, "Couldn't reach ByteSize. Check your connection and try again.");
  }

  if (res.status === 401 && !path.startsWith("/api/auth/") && !path.startsWith("/api/passkeys/login/")) {
    setToken(null);
    window.dispatchEvent(new Event("bytesize:logout"));
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, errorText(data, res.status), data.details, data);
  return data as T;
}

// A request whose answer may come as lines (application/x-ndjson): progress lines ({ progress }) are handed
// to onLine as they arrive; the other line is the answer (or { error, status }). A server that answers with
// plain JSON works too. signal: stop waiting (fetch rejects with an AbortError, which is passed on as is).
export async function apiLines<T = unknown>(method: string, path: string, body: unknown, opts: { signal?: AbortSignal; onLine?: (line: Record<string, unknown>) => void } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-device-id": deviceId(), "content-type": "application/json", accept: "application/x-ndjson, application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const unreachable = () => new ApiError(0, "Couldn't reach ByteSize. Check your connection and try again.");
  const passOn = (e: unknown) => {
    throw opts.signal?.aborted ? e : unreachable();
  };
  const res = await fetch(path, { method, headers, body: JSON.stringify(body), signal: opts.signal }).catch(passOn);
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event("bytesize:logout"));
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, errorText(data, res.status), data.details, data);
    return data as T;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let answer: Record<string, unknown> | null = null;
  const take = (text: string) => {
    if (!text.trim()) return;
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw unreachable(); // not ByteSize's answer (e.g. a proxy's error page)
    }
    if ("progress" in line) opts.onLine?.(line);
    else answer = line;
  };
  for (;;) {
    const { value, done } = await reader.read().catch(passOn);
    if (value) {
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        take(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (done) break;
  }
  take(buf);
  const got = answer as Record<string, unknown> | null;
  if (!got) throw unreachable(); // cut off before the answer came
  if (typeof got.error === "string") throw new ApiError(typeof got.status === "number" ? got.status : 500, got.error);
  return got as T;
}

// The name in a Content-Disposition header: filename*=UTF-8''… is percent-encoded, a plain filename="…" is not
function fileNameFrom(header: string): string | null {
  const encoded = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      /* not valid encoding: fall through to the plain name */
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? null;
}

// A file the server sends (the data export, a backup): fetched with the login token, since a plain link
// can't carry it. The name the server chose comes from Content-Disposition.
export async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = { "x-device-id": deviceId() };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { headers });
  } catch {
    throw new ApiError(0, "Couldn't reach ByteSize. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorText(data, res.status), data.details);
  }
  const header = res.headers.get("content-disposition") ?? "";
  const filename = fileNameFrom(header) ?? path.split("/").pop() ?? "download";
  return { blob: await res.blob(), filename };
}

// Hand a downloaded file to the browser's save dialog / Downloads folder
export function saveFile({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
