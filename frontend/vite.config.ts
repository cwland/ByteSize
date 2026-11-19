/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";

// The app version shown on the sign-in screen and in Settings (from package.json)
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The API's address for `npm run dev`: API_PROXY_TARGET if set, otherwise the PORT in backend/.env,
// otherwise 4100
const backendEnv = new URL("../backend/.env", import.meta.url);
const apiPort = existsSync(backendEnv) ? readFileSync(backendEnv, "utf8").match(/^PORT=(\d+)/m)?.[1] : undefined;
const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${apiPort ?? 4100}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Screen tests run in a pretend browser (jsdom)
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
  server: {
    port: 5173,
    // xfwd: pass the browser's address along, so Signed-in devices shows the real IP
    proxy: { "/api": { target: apiTarget, xfwd: true } },
  },
});
