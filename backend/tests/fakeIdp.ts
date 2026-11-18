import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// A pretend OpenID Connect provider (like Authentik) for tests: discovery, JWKS, token and user info.
// Hand fetchImpl to the app (oauthFetch); approve() plays the person signing in at the provider.
export function fakeIdp(issuer = "https://idp.test/application/o/bytesize") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; sub: string; email?: string; verified?: boolean; redirectUri: string; challenge: string }>();
  const state = { clientId: "bs-client", clientSecret: "bs-secret", tokenCalls: 0, down: false, discoveryCalls: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const s256 = (v: string) => crypto.createHash("sha256").update(v).digest("base64url");

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (state.down) throw new TypeError("fetch failed");
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      state.discoveryCalls++;
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname.endsWith("/jwks")) return json({ keys: [jwk] });
    if (url.pathname.endsWith("/token")) {
      state.tokenCalls++;
      const form = new URLSearchParams(String(init?.body ?? ""));
      // client_secret_basic: the ID and secret in the Authorization header
      const basic = new Headers(init?.headers).get("authorization")?.replace(/^Basic /, "");
      const [id, secret] = basic ? Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent) : [form.get("client_id"), form.get("client_secret")];
      const c = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier");
      if (!c || id !== state.clientId || secret !== state.clientSecret || form.get("redirect_uri") !== c.redirectUri || !verifier || s256(verifier) !== c.challenge)
        return json({ error: "invalid_grant" }, 400);
      codes.delete(form.get("code")!);
      const claims: Record<string, unknown> = { nonce: c.nonce };
      if (c.email !== undefined) claims.email = c.email;
      if (c.verified !== undefined) claims.email_verified = c.verified;
      const idToken = jwt.sign(claims, privateKey, { algorithm: "RS256", keyid: "k1", issuer, audience: state.clientId, subject: c.sub, expiresIn: 300 });
      return json({ access_token: `at-${c.sub}`, token_type: "Bearer", id_token: idToken, expires_in: 300 });
    }
    if (url.pathname.endsWith("/userinfo")) return json({});
    return json({ error: "not found" }, 404);
  }) as typeof fetch;

  return {
    issuer,
    state,
    fetchImpl,
    // The person signs in at the provider: returns where the provider sends the browser back to
    approve(authorizeUrl: string, who: { sub: string; email?: string; verified?: boolean }) {
      const u = new URL(authorizeUrl);
      const code = `code-${crypto.randomBytes(8).toString("hex")}`;
      codes.set(code, { nonce: u.searchParams.get("nonce") ?? "", redirectUri: u.searchParams.get("redirect_uri")!, challenge: u.searchParams.get("code_challenge")!, ...who });
      const back = new URL(u.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", u.searchParams.get("state")!);
      return back;
    },
  };
}
