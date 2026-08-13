#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version || "").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Ungültige package.json-Version: ${version}`);

const appFile = path.join(ROOT, "src/appVersion.ts");
fs.writeFileSync(appFile, `export const APP_VERSION = ${JSON.stringify(version)};\n`);

const swFile = path.join(ROOT, "public/sw.js");
let sw = fs.readFileSync(swFile, "utf8");
const cacheVersion = version.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
if (!/const CACHE_NAME = ["'][^"']+["'];/.test(sw)) throw new Error("CACHE_NAME in public/sw.js nicht gefunden.");
sw = sw.replace(/const CACHE_NAME = ["'][^"']+["'];/, `const CACHE_NAME = "tsu-ainet-v${cacheVersion}";`);
fs.writeFileSync(swFile, sw);
console.log(`App-Version synchronisiert: ${version}`);
