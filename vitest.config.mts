import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // tsconfig keeps jsx "preserve" for Next; tests compile slot components themselves.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      // Next resolves "server-only" to an empty module on the server; tests run server code too.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
