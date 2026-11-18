import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { requireAdmin } from "../lib/guards.js";
import { EMAIL_SECURITY, type EmailConfig } from "../lib/mail.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";

// Settings › Email (admin only). The password is never sent with the settings: only the eye and copy
// buttons fetch it (GET /api/settings/email/password). Save needs a test email that went through first.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const emailSettings = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().max(253).default(""),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    security: z.enum(EMAIL_SECURITY).default("starttls"),
    username: optionalText(320),
    password: z.string().max(500).nullable().optional(), // left out: keep the saved one; "" or null: remove it
    fromName: optionalText(100),
    fromAddress: z.string().trim().max(320).default(""),
    appUrl: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.fromAddress && !z.string().email().safeParse(v.fromAddress).success) {
      ctx.addIssue({ code: "custom", path: ["fromAddress"], message: "The from address isn't a valid email" });
    }
    if (v.appUrl && !/^https?:\/\/[^\s/]+/.test(v.appUrl)) {
      ctx.addIssue({ code: "custom", path: ["appUrl"], message: "The app's address starts with http:// or https://" });
    }
    if (v.enabled) {
      if (!v.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Enter the email server" });
      if (!v.fromAddress) ctx.addIssue({ code: "custom", path: ["fromAddress"], message: "Enter the from address" });
    }
  });
type EmailForm = z.infer<typeof emailSettings>;

export default async function emailSettingsRoutes(app: FastifyInstance) {
  const { db, mail } = app;

  const accountEmail = async (userId: number) => (await db.select({ email: users.email }).from(users).where(eq(users.id, userId)))[0]?.email ?? null;

  // The settings as they'd be sent with. Test (blankKeeps): a blank password is the saved one.
  // Save: only a password left out is the saved one; "" or null is none.
  const configFrom = async (f: EmailForm, blankKeeps: boolean): Promise<EmailConfig> => {
    const { enabled: _e, password, ...rest } = f;
    const keep = blankKeeps ? !password : password === undefined;
    return { ...rest, appUrl: rest.appUrl ? rest.appUrl.replace(/\/+$/, "") : null, password: keep ? ((await mail.storedPassword()) ?? null) : password || null };
  };

  app.get("/api/settings/email", async (req) => {
    const userId = requireAdmin(req);
    const stored = await mail.stored();
    const active = await mail.active();
    const password = await mail.storedPassword();
    return {
      source: stored ? "app" : (active?.source ?? "none"), // where the settings come from
      active: !!active,
      settings: stored
        ? {
            enabled: stored.enabled,
            host: stored.host,
            port: stored.port,
            security: stored.security,
            username: stored.username,
            passwordSet: !!stored.passwordEnc,
            passwordUnreadable: !!stored.passwordEnc && password === null,
            fromName: stored.fromName,
            fromAddress: stored.fromAddress,
            appUrl: stored.appUrl,
          }
        : null,
      env: { available: mail.envAvailable, host: mail.envHost },
      accountEmail: await accountEmail(userId),
    };
  });

  // The eye and copy buttons
  app.get("/api/settings/email/password", { config: revealRateLimit }, async (req, reply) => {
    const userId = requireAdmin(req);
    const s = await mail.stored();
    return sendSavedKey(app, reply, userId, "Email password", { key: openSaved(s?.passwordEnc, app.jwtSecret) });
  });

  app.put("/api/settings/email", async (req) => {
    requireAdmin(req);
    const body = emailSettings.parse(req.body ?? {});
    if (body.enabled) {
      // Only settings a test email went through on (or the ones already working) can be turned on
      const next = await configFrom(body, false);
      const current = await mail.active();
      if (!(current && mail.sameConnection(current.config, next)) && !mail.wasTested(next)) {
        throw new HttpError(400, "Send a test email with these settings first. Save works once it goes through.");
      }
    }
    const { password, ...rest } = body;
    await mail.save(rest, password === null ? "" : password);
    return { ok: true };
  });

  // Forget the app's settings (.env is used again, if it has some)
  app.delete("/api/settings/email", async (req, reply) => {
    requireAdmin(req);
    await mail.clear();
    return reply.status(204).send();
  });

  // Send a test email: with settings, the form's (unsaved) values; otherwise the ones in use
  app.post("/api/settings/email/test", async (req) => {
    const userId = requireAdmin(req);
    const body = z.object({ settings: emailSettings.optional(), to: z.string().trim().email("Enter a valid address to send the test to").optional() }).parse(req.body ?? {});
    let config: EmailConfig;
    if (body.settings) {
      config = await configFrom(body.settings, true);
      if (!config.host || !config.fromAddress) throw new HttpError(400, "Fill in the email server and the from address first");
    } else {
      const active = await mail.active();
      if (!active) throw new HttpError(400, "Email isn't set up yet");
      config = active.config;
    }
    const to = body.to ?? (await accountEmail(userId));
    if (!to) throw new HttpError(400, "Add an email address to your profile, or enter one to send the test to");
    try {
      await mail.verify(config);
      await mail.send({ to, subject: "ByteSize test email", text: `Email from ByteSize is working. Forgot-password codes will arrive like this one.${config.appUrl ? `\n\n${config.appUrl}` : ""}` }, "test", { config, userId });
    } catch (err) {
      req.log.warn(err);
      throw new HttpError(502, `Couldn't send: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    mail.noteTested(config);
    return { ok: true, to };
  });
}
