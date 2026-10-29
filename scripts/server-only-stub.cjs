// Lets tsx scripts (seed, setup) load server code that imports "server-only".
// Next.js resolves "server-only" to an empty module on the server; this does the same for Node.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload for `tsx --require` */
const Module = require("node:module");
const path = require("node:path");

const empty = path.join(path.dirname(require.resolve("server-only", { paths: [process.cwd()] })), "empty.js");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "server-only" ? empty : resolve.call(this, request, ...rest);
};
