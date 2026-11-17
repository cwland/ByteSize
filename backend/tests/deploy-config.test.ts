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
});
