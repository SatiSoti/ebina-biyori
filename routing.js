((root, factory) => {
  const router = factory();
  if (typeof module === "object" && module.exports) module.exports = router;
  if (root) root.EBINA_ROUTER = router;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  const oneSegmentRoutes = new Map([
    ["pickup", "pickup"],
    ["news", "news-list"],
    ["map", "map"],
    ["followups", "followups-list"],
    ["tips", "tips"],
    ["feedback", "feedback"],
    ["corrections", "corrections"],
    ["search", "search"],
    ["about", "about"],
    ["editorial", "editorial"],
    ["privacy", "privacy"],
  ]);

  const cleanPath = (value) => {
    const path = String(value || "/");
    return path.startsWith("/") ? path : `/${path}`;
  };

  const href = (value) => {
    const url = new URL(cleanPath(value), "https://ebina.invalid/");
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const legacyHashTarget = (locationLike) => {
    const hash = String(locationLike?.hash || "");
    return hash.startsWith("#/") ? href(hash.slice(1)) : null;
  };

  const parse = (locationLike) => ({
    pathname: cleanPath(locationLike?.pathname || "/"),
    params: new URLSearchParams(String(locationLike?.search || "").replace(/^\?/, "")),
  });

  const match = (pathname, issuesEnabled = false) => {
    const segments = cleanPath(pathname).split("/").filter(Boolean);
    if (!segments.length) return { name: "home", segments };
    if (segments.length === 1 && oneSegmentRoutes.has(segments[0])) return { name: oneSegmentRoutes.get(segments[0]), segments };
    if (segments.length === 2 && segments[0] === "news") return { name: "news-detail", id: segments[1], segments };
    if (segments.length === 2 && segments[0] === "areas") return { name: "area-detail", id: segments[1], segments };
    if (segments.length === 2 && segments[0] === "followups") return { name: "followup-detail", id: segments[1], segments };
    if (issuesEnabled && segments.length === 1 && segments[0] === "issues") return { name: "issues-list", segments };
    if (issuesEnabled && segments.length === 2 && segments[0] === "issues") return { name: "issue-detail", id: segments[1], segments };
    return { name: "not-found", segments };
  };

  return { href, legacyHashTarget, match, parse };
});
