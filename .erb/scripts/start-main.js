// Development entry for the main process (`npm run start:main`, spawned by `npm start`).
// Electron 42 bundles Node 24, which loads a `.ts` entry itself as an ES module, so
// `electron -r ts-node/register ./src/main/main.ts` no longer goes through ts-node and fails on
// CommonJS-style imports such as "core-js/stable". Requiring main.ts from this CommonJS file
// sends it through ts-node's require hook again. Production builds use webpack and never load this.
require("ts-node/register/transpile-only");
require("../../src/main/main.ts");
