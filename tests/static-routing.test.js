const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("does not generate hash routes or mutate location.hash", () => {
  const app = read("app.js");
  assert.doesNotMatch(app, /href=["']#\//);
  assert.doesNotMatch(app, /location\.hash\s*=/);
  assert.doesNotMatch(app, /hashchange/);
});

test("uses root-relative local assets for nested path reloads", () => {
  const sources = [read("index.html"), read("app.js"), read("bootstrap.js"), read("styles.css")].join("\n");
  assert.doesNotMatch(sources, /(?:src|href)=["']\.\//);
  assert.doesNotMatch(sources, /url\(["']?\.\//);
  assert.doesNotMatch(sources, /(?:script|link)\.(?:src|href)\s*=\s*["']\.\//);
});

test("every root-relative index asset exists", () => {
  const index = read("index.html");
  const assets = [...index.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)].map((match) => match[1]);
  assets.forEach((asset) => assert.equal(fs.existsSync(path.join(root, asset)), true, asset));
});
