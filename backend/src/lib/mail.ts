import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

// Settings › Email (admin): the account ByteSize sends email from (forgot-password codes).
// Saved in app_settings under "email", the password encrypted. SMTP_* / MAIL_FROM / APP_URL in .env
// are used when nothing is saved in the app. (Copied from Culury's lib/mail.ts.)

// starttls: plain connection upgraded to TLS (required) - usually port 587
// ssl:      TLS from the start - usually port 465
// auto:     use TLS if the server offers it
// none:     never use TLS (local relays only)
export const EMAIL_SECURITY = ["starttls", "ssl", "auto", "none"] as const;
export type EmailSecurity = (typeof EMAIL_SECURITY)[number];

export interface EmailConfig {
  host: string;
  port: number;
  security: EmailSecurity;
  username: string | null;
  password: string | null;
  fromName: string | null;
  fromAddress: string;
  appUrl: string | null; // the app's own address, used in emails
}

// What's saved in app_settings under "email" (password encrypted)
export interface StoredEmail extends Omit<EmailConfig, "password"> {
  enabled: boolean;
  passwordEnc: string | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Transport {
  sendMail(msg: MailMessage & { from: string }): Promise<unknown>;
  verify?(): Promise<unknown>;
}
export type TransportFactory = (config: EmailConfig) => Transport;

// A mail server that doesn't answer is given up on, so it can't hold up a send (or shutting down)
export const smtpOptions = (c: EmailConfig) => ({
  host: c.host,
  port: c.port,
  secure: c.security === "ssl",
  requireTLS: c.security === "starttls",
  ignoreTLS: c.security === "none",
  auth: c.username ? { user: c.username, pass: c.password ?? "" } : undefined,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});
export const smtpTransport: TransportFactory = (c) => nodemailer.createTransport(smtpOptions(c));

const trimUrl = (u: string) => u.replace(/\/+$/, "");

// Email from .env: used when nothing is saved in the app
export function emailConfigFromEnv(env: NodeJS.ProcessEnv): EmailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  return {
    host,
    port,
    security: secure ? "ssl" : "auto",
    username: env.SMTP_USER || null,
    password: env.SMTP_PASS || null,
    fromName: null,
    fromAddress: from,
    appUrl: env.APP_URL ? trimUrl(env.APP_URL) : null,
  };
}

export const fromHeader = (c: EmailConfig) => (c.fromName ? `"${c.fromName.replace(/["\\]/g, "")}" <${c.fromAddress}>` : c.fromAddress);

export type EmailKind = "test" | "reset-code" | "invite" | "recap";
const EMAIL_KIND_LABELS: Record<EmailKind, string> = { test: "Test email", "reset-code": "Password reset code", invite: "Invite", recap: "Weekly recap" };

/** The address's origin ("https://host:port"), or null for nothing usable. */
export const originOf = (u: string | null | undefined) => {
  try {
    const o = u ? new URL(u).origin : null;
    return o === "null" ? null : o; // (javascript:, data: and the like have no origin)
  } catch {
    return null;
  }
};
/** The app's address as saved, its sub-path kept (ByteSize behind a proxy at /bytesize), no trailing slash (§46). */
export const appBaseOf = (u: string | null | undefined) => {
  const origin = originOf(u);
  if (!origin) return null;
  return `${origin}${new URL(u!).pathname.replace(/\/+$/, "")}`;
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// What decides whether email gets through: a test email proves these, so only a change to them needs a new test
const connectionPrint = (c: EmailConfig) => crypto.createHash("sha256").update(JSON.stringify([c.host, c.port, c.security, c.username, c.password, c.fromAddress])).digest("hex");
const TEST_COUNTS_MS = 60 * 60 * 1000; // a test email lets Save through for an hour

export class MailService {
  // Connections a test email went through on (fingerprint -> when), so Save can tell
  private tested = new Map<string, number>();

  constructor(
    private db: Db,
    private secret: string,
    private envConfig: EmailConfig | null,
    private transport: TransportFactory = smtpTransport,
    private now: () => Date = () => new Date()
  ) {}

  get envAvailable() {
    return this.envConfig !== null;
  }
  get envHost() {
    return this.envConfig ? `${this.envConfig.host}:${this.envConfig.port}` : null;
  }

  async stored(): Promise<StoredEmail | null> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, "email"));
    return (row?.value as StoredEmail) ?? null;
  }

  // The saved password: undefined = none saved, null = saved but can't be read (JWT_SECRET changed)
  async storedPassword(): Promise<string | null | undefined> {
    const s = await this.stored();
    return s?.passwordEnc ? decryptSecret(s.passwordEnc, this.secret) : undefined;
  }

  /** password: undefined keeps the saved one; "" or null removes it. */
  async save(settings: Omit<StoredEmail, "passwordEnc">, password: string | null | undefined) {
    const current = await this.stored();
    const passwordEnc = password === undefined ? (current?.passwordEnc ?? null) : password ? encryptSecret(password, this.secret) : null;
    const value: StoredEmail = { ...settings, appUrl: settings.appUrl ? trimUrl(settings.appUrl) : null, passwordEnc };
    await this.db
      .insert(appSettings)
      .values({ key: "email", value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  async clear() {
    await this.db.delete(appSettings).where(eq(appSettings.key, "email"));
  }

  // The settings in use: saved in the app (if any), otherwise .env. null: email is off.
  async active(): Promise<{ config: EmailConfig; source: "app" | "env" } | null> {
    const s = await this.stored();
    if (s) {
      if (!s.enabled) return null; // turned off in the app (.env isn't used then)
      const { enabled: _e, passwordEnc: _p, ...rest } = s;
      return { config: { ...rest, password: (await this.storedPassword()) ?? null }, source: "app" };
    }
    return this.envConfig ? { config: this.envConfig, source: "env" } : null;
  }

  /** Sends, and notes it in Settings › Logs (the subject only; logSubject replaces a subject that holds a code). */
  async send(msg: MailMessage, kind: EmailKind, opts: { config?: EmailConfig; logSubject?: string; userId?: number | null } = {}) {
    const c = opts.config ?? (await this.active())?.config;
    if (!c) throw new Error("Email isn't set up");
    const subject = opts.logSubject ?? msg.subject;
    const log = (ok: boolean, error?: string) =>
      logEvent(this.db, {
        category: "email",
        level: ok ? "info" : "error",
        source: EMAIL_KIND_LABELS[kind],
        event: ok ? `Sent "${subject}" to ${msg.to}` : `Couldn't send "${subject}" to ${msg.to}`,
        detail: error ?? null,
        userId: opts.userId ?? null,
      });
    try {
      await this.transport(c).sendMail({ from: fromHeader(c), ...msg });
    } catch (err) {
      await log(false, (err as Error).message);
      throw err;
    }
    await log(true);
  }

  /** Connect and sign in without sending (clear errors for a wrong server or password). */
  async verify(config: EmailConfig) {
    const t = this.transport(config);
    if (t.verify) await t.verify();
  }

  // ---------- work done after the answer (forgot-password emails) ----------

  private pending = new Set<Promise<void>>();

  /** Runs work without the caller waiting for it (errors go to onError). Never rejects: nothing waits for it. */
  background(work: () => Promise<void>, onError: (err: unknown) => void | Promise<void>) {
    const handle = async (err: unknown) => {
      try {
        await onError(err);
      } catch (again) {
        console.error("Background work failed, and so did its error handler:", err, again); // e.g. the database is down
      }
    };
    const p: Promise<void> = Promise.resolve()
      .then(work)
      .catch(handle)
      .catch(() => {})
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Resolves once no background work is left (tests, and shutting down). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  // ---------- Save needs a test email that went through ----------

  noteTested(config: EmailConfig) {
    this.tested.set(connectionPrint(config), this.now().getTime());
  }
  wasTested(config: EmailConfig) {
    const at = this.tested.get(connectionPrint(config));
    return at !== undefined && this.now().getTime() - at < TEST_COUNTS_MS;
  }
  sameConnection(a: EmailConfig, b: EmailConfig) {
    return connectionPrint(a) === connectionPrint(b);
  }
  forgetTests() {
    this.tested.clear();
  }
}
