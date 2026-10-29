// Runs `next <command>` after loading .env.local and .env, so PORT from .env.local
// applies to `npm run dev` and `npm start` (Next reads PORT before it loads env files).
// Variables already set in the shell win, then .env.local, then .env.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { config } from "dotenv";

for (const file of [".env.local", ".env"]) if (existsSync(file)) config({ path: file, quiet: true });

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
