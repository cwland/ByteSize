import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const TOKEN_LIFETIME = "30d";

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// tv = the user's token version when signed. Bumping the version signs out every device.
// sid = the signed-in device (sessions.tokenId), so one device can be signed out on its own.
export function signToken(userId: number, tokenVersion: number, secret: string, sid?: string) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion, ...(sid ? { sid } : {}) }, secret, { expiresIn: TOKEN_LIFETIME });
}

export function verifyToken(token: string, secret: string): { userId: number; tokenVersion: number; sid: string | null; iat: number | null; exp: number | null } | null {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "object" && payload.sub) {
      return {
        userId: Number(payload.sub),
        tokenVersion: typeof payload.tv === "number" ? payload.tv : 0,
        sid: typeof payload.sid === "string" ? payload.sid : null,
        iat: payload.iat ?? null,
        exp: payload.exp ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// SHA-256 of a secret (legacy token ids; API keys in M4)
export const hashApiKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");
