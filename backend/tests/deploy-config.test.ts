import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

// The app inside the container always listens on 4100; PORT in .env only chooses the port on the host.
// (env_file passes PORT into the container too, so compose must pin it back.)
describe("docker compose", () => {
  const compose = fs.readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");

  it("pins the container's port so changing PORT in .env only moves the host port", () => {
    expect(compose).toMatch(/environment:\n(?:\s+#.*\n|\s+\w+:.*\n)*?\s+PORT: "?4100"?\n/);
    expect(compose).toContain('"${PORT:-4100}:4100"');
  });
});

describe("docker image", () => {
  const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

  it("image fixes data folder ownership before dropping to node", () => {
    expect(dockerfile).not.toMatch(/^USER node$/m);
    expect(dockerfile).toContain('ENTRYPOINT ["/app/docker-entrypoint.sh"]');
    const script = fs.readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");
    expect(script).toContain("chown -R node:node /app/data");
    expect(script).toContain("setpriv");
  });

  it("starts anyway, with a warning, when the data folder's owner can't be changed", () => {
    // Stand-ins: we're "root", chown fails (an NFS share or read-only mount), setpriv reports what it would start
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "entry-"));
    const stub = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub("id", "echo 0");
    stub("chown", "echo 'chown: Operation not permitted' >&2; exit 1");
    stub("setpriv", 'echo "started as node: $*"');
    const script = new URL("../docker-entrypoint.sh", import.meta.url).pathname;
    const r = spawnSync("sh", [script], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
    fs.rmSync(bin, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("started as node:");
    expect(r.stderr).toMatch(/couldn't change the owner of \/app\/data/i);
  });
});
