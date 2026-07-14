const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../routing.js");

const routes = [
  ["/", "home"],
  ["/pickup", "pickup"],
  ["/news", "news-list"],
  ["/news/article-slug", "news-detail"],
  ["/map", "map"],
  ["/areas/14215001201", "area-detail"],
  ["/followups", "followups-list"],
  ["/followups/theme-slug", "followup-detail"],
  ["/tips", "tips"],
  ["/feedback", "feedback"],
  ["/corrections", "corrections"],
  ["/search", "search"],
  ["/about", "about"],
  ["/editorial", "editorial"],
  ["/privacy", "privacy"],
];

test("matches every public pathname route", () => {
  routes.forEach(([path, name]) => assert.equal(router.match(path).name, name, path));
});

test("rejects unknown and over-nested routes", () => {
  ["/unknown", "/map/extra", "/news/a/extra", "/issues", "/issues/example"].forEach((path) => {
    assert.equal(router.match(path).name, "not-found", path);
  });
});

test("keeps disabled issue routes behind their feature flag", () => {
  assert.equal(router.match("/issues", true).name, "issues-list");
  assert.equal(router.match("/issues/example", true).name, "issue-detail");
});

test("migrates only legacy hash routes", () => {
  assert.equal(router.legacyHashTarget({ hash: "#/map" }), "/map");
  assert.equal(router.legacyHashTarget({ hash: "#/news/example?from=share" }), "/news/example?from=share");
  assert.equal(router.legacyHashTarget({ hash: "#/areas/14215001201" }), "/areas/14215001201");
  assert.equal(router.legacyHashTarget({ hash: "#main-content" }), null);
  assert.equal(router.legacyHashTarget({ hash: "" }), null);
});

test("parses pathname queries independently from fragments", () => {
  const route = router.parse({ pathname: "/news", search: "?category=transport", hash: "" });
  assert.equal(route.pathname, "/news");
  assert.equal(route.params.get("category"), "transport");
});
