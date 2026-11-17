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
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
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
  if (!res.ok) throw new ApiError(res.status, errorText(data, res.status), data.details);
  return data as T;
}
