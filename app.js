(() => {
  const data = window.EBINA_DATA;
  const areas = window.EBINA_AREAS;
  const guideData = window.EBINA_GUIDE_DATA || { areas: {} };
  const publicConfig = window.EBINA_PUBLIC_CONFIG || {};
  const router = window.EBINA_ROUTER;
  const publicState = window.EBINA_PUBLIC_STATE || { mode: "demo", connected: false, publishedCount: 0 };
  const previewMode = publicState.previewMode !== false;
  const liveNews = publicState.mode === "live";
  const liveFollowups = publicState.followupsConnected === true;
  const liveGuide = publicState.guideConnected === true;
  const issuesEnabled = false;
  if (!issuesEnabled) {
    data.issues = [];
    data.mapPoints = data.mapPoints.filter((item) => item.kind !== "課題候補" && !String(item.target || "").startsWith("/issues/"));
    data.mapItems = data.mapItems.filter((item) => item.status !== "地域課題");
  }
  let mapGeo = window.EBINA_MAP_GEO || null;
  const app = document.querySelector("#app");
  const categoryMap = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
  const MAP_STATE_KEY = "ebina-update-map-state-v1";
  const MAP_GUIDE_KEY = "ebina-update-map-guide-seen-v1";
  const LANDMARK_ASSET_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|webp)$/;
  const optionalLandmarkAssetFile = (value) => {
    const file = String(value || "").split(/[\\/]/).at(-1);
    return LANDMARK_ASSET_PATTERN.test(file) ? file : "";
  };
  const landmarkAssetFile = (value) => {
    return optionalLandmarkAssetFile(value) || "ebina-station.svg";
  };
  const rawLandmarks = Array.isArray(window.EBINA_CITY_LANDMARKS)
    ? window.EBINA_CITY_LANDMARKS
    : window.EBINA_CITY_LANDMARKS?.items || [];
  const CITY_LANDMARKS = rawLandmarks
    .filter((landmark) => landmark.enabled !== false)
    .map((landmark, index) => ({
      ...landmark,
      id: String(landmark.id || ""),
      imagePath: landmarkAssetFile(landmark.imagePath || `${landmark.id}.svg`),
      lng: Number(landmark.lng),
      lat: Number(landmark.lat),
      zoom: Number(landmark.zoom || 14.2),
      sortOrder: Number(landmark.sortOrder ?? index),
      color: /^#[0-9a-f]{6}$/i.test(String(landmark.color || "")) ? landmark.color : "#1c3966",
    }))
    .filter((landmark) => landmark.id && landmark.name && Number.isFinite(landmark.lng) && Number.isFinite(landmark.lat))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const readMapState = () => {
    if (window.ebinaMapState) return window.ebinaMapState;
    try {
      const saved = window.sessionStorage?.getItem(MAP_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (_) { return null; }
  };
  const writeMapState = (state) => {
    window.ebinaMapState = state;
    try { window.sessionStorage?.setItem(MAP_STATE_KEY, JSON.stringify(state)); } catch (_) { /* file preview may block storage */ }
  };
  const areaTown = (areaId) => areas.towns.find((town) => String(town.id) === String(areaId));
  const areaFeature = (areaId) => mapGeo?.areas?.features.find((feature) => String(feature.id) === String(areaId));
  const areaItems = (areaId) => data.mapItems.filter((item) => String(item.areaId) === String(areaId));
  const CENTRAL_1_AREA_ID = "14215001201";
  const nearestAreaIdForPoint = (point) => {
    if (point.areaId) return String(point.areaId);
    const projected = projectAreaPoint(point);
    const sameBase = areas.towns.filter((town) => town.base === point.town);
    return (sameBase.length ? sameBase : areas.towns).reduce((best, town) => {
      const distance = Math.hypot(town.cx - projected.svgX, town.cy - projected.svgY);
      return !best || distance < best.distance ? { id: String(town.id), distance } : best;
    }, null)?.id || "";
  };
  const areaSharedUpdates = (areaId) => {
    const id = String(areaId);
    const pointUpdates = data.mapPoints.filter((point) => nearestAreaIdForPoint(point) === id).map((point) => {
      const content = mapPointContent(point);
      const followup = String(point.target || "").startsWith("/followups/");
      return { id: `shared-${point.id}`, type: followup ? "followup" : "news", kind: followup ? "その後、どうなった？" : "ニュース", title: content.title, summary: content.summary, date: content.meta, target: point.target, lat: point.lat, lng: point.lng, color: mapPointColor(point) };
    });
    const itemUpdates = areaItems(id).filter((item) => !(id === CENTRAL_1_AREA_ID && item.id === "demo-central-plaza")).map((item) => {
      const followup = ["検討中", "続報待ち"].includes(item.status);
      return { id: `shared-item-${item.id}`, type: followup ? "followup" : "news", kind: followup ? "その後、どうなった？" : "ニュース", title: item.title, summary: item.summary, date: `更新 ${item.updatedAt}`, target: item.relatedArticles?.[0]?.href || `/areas/${id}`, lat: item.lat, lng: item.lng, color: mapItemColor(item.status) };
    });
    const centralTracking = id === CENTRAL_1_AREA_ID ? data.followups.find((item) => item.id === "station-east-renewal") : null;
    const centralTrackingUpdate = centralTracking ? [{ id: `shared-followup-${centralTracking.id}`, type: "followup", kind: "その後、どうなった？", title: centralTracking.title, summary: centralTracking.summary, date: `最終確認 ${centralTracking.updatedAt}`, target: `/followups/${centralTracking.id}`, lat: 35.45255, lng: 139.39155, color: "#1c3966" }] : [];
    return [...pointUpdates, ...itemUpdates, ...centralTrackingUpdate];
  };
  const cityPointsForBase = (base) => data.mapPoints.filter((point) => point.town === base);

  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const href = (path) => router.href(path);
  const projectAreaPoint = (point) => {
    const p = areas.project;
    const x = p.offsetX + (point.lng - p.lonMin) * p.cosLat * p.scale;
    const y = p.offsetY + (p.latMax - point.lat) * p.scale;
    return { x: x / p.width * 100, y: y / p.height * 100, svgX: x, svgY: y };
  };
  const unprojectAreaPoint = (svgX, svgY) => {
    const p = areas.project;
    return { lng: p.lonMin + (svgX - p.offsetX) / (p.cosLat * p.scale), lat: p.latMax - (svgY - p.offsetY) / p.scale };
  };
  const cityLandmarkIllustration = (imagePath) => `<img class="city-landmark-art" src="/assets/landmarks/${esc(landmarkAssetFile(imagePath))}" alt="" decoding="async" draggable="false">`;
  const guidePlaceIllustration = (imagePath, alt = "") => {
    const file = optionalLandmarkAssetFile(imagePath);
    return file ? `<img class="guide-place-illustration" src="/assets/landmarks/${esc(file)}" alt="${esc(alt)}" decoding="async" draggable="false">` : "";
  };
  const mapPointColor = (point) => ({ orange: "#c94731", teal: "#155e63", blue: "#326f9a", amber: "#a77a2b" })[point.tone] || "#c94731";
  const mapPointContent = (point) => {
    const [type, id] = String(point.target || "").split("/").filter(Boolean);
    if (type === "news") { const item = data.news.find((entry) => entry.id === id); if (item) return { title: item.title, summary: item.excerpt, meta: `${item.sourceType}　/　確認 ${item.checkedAt}`, linkLabel: "記事を読む" }; }
    if (type === "followups") { const item = data.followups.find((entry) => entry.id === id); if (item) return { title: item.title, summary: item.summary, meta: `${item.status}　/　最終確認 ${item.updatedAt}`, linkLabel: "追跡レポートを見る" }; }
    if (type === "issues") { const item = data.issues.find((entry) => entry.id === id); if (item) return { title: item.title, summary: item.summary, meta: `${item.stage}　/　課題候補`, linkLabel: "課題ページを見る" }; }
    return { title: point.label, summary: `${point.area}に関連するデモ情報です。`, meta: point.kind, linkLabel: "詳しく見る" };
  };
  const newsCard = (item) => `
    <a class="news-card" href="${href(`/news/${item.id}`)}">
      <div class="card-tags"><span class="tag">${esc(categoryMap[item.category])}</span><span class="tag tag--source">${esc(item.sourceType)}</span></div>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.excerpt)}</p>
      <div class="story-meta"><span>発表 ${esc(item.publishedAt)}</span><span>確認 ${esc(item.checkedAt)}</span></div>
    </a>`;

  const status = (value) => `<span class="status" data-status="${esc(value)}">${esc(value)}</span>`;
  const followupRow = (item) => `
    <a class="followup-row" href="${href(`/followups/${item.id}`)}">
      ${status(item.status)}
      <div><h3>${esc(item.title)}</h3><p>最終確認 ${esc(item.updatedAt)}　・　次に確認：${esc(item.nextCheck)}</p></div>
      <span class="arrow" aria-hidden="true">→</span>
    </a>`;
  const issueCard = (item) => `
    <a class="issue-card" href="${href(`/issues/${item.id}`)}">
      <span class="tag tag--orange">${esc(item.kicker)}</span><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><span class="text-link">調査の設計を見る →</span>
    </a>`;

  const svgMapView = (compact = false) => {
    const counts = Object.fromEntries(areas.labels.map((label) => [label.name, 0]));
    data.mapPoints.forEach((point) => { counts[point.town] = (counts[point.town] || 0) + 1; });
    if (compact) {
      const markers = data.mapPoints.map((newsPoint) => { const point = projectAreaPoint(newsPoint); return `<a href="${href(newsPoint.target)}" aria-label="${esc(newsPoint.area)}の${esc(newsPoint.label)}を開く"><title>${esc(newsPoint.area)}：${esc(newsPoint.label)}</title><circle class="home-town-marker-halo" cx="${point.svgX}" cy="${point.svgY}" r="10" style="--item-color:${mapPointColor(newsPoint)}"></circle><circle class="home-town-marker" cx="${point.svgX}" cy="${point.svgY}" r="5" style="--item-color:${mapPointColor(newsPoint)}"></circle></a>`; }).join("");
      return `<div class="map-experience map-experience--compact"><div class="map-canvas home-town-map" data-home-town-map-link role="link" tabindex="0" aria-label="町丁目マップを開く"><svg class="home-town-svg" viewBox="${esc(areas.viewBox)}" role="img" aria-label="海老名市の主要地域とニュース地点"><rect class="home-town-paper" width="700" height="900"></rect><g class="home-town-regions">${areas.towns.map((town) => `<path d="${esc(town.d)}" class="${cityPointsForBase(town.base).length ? "has-update" : ""}"><title>${esc(town.name)}</title></path>`).join("")}</g><path class="home-town-outline" d="${esc(areas.outline)}"></path><g class="home-town-labels">${areas.labels.map((label) => `<g transform="translate(${label.x} ${label.y})"><text text-anchor="middle" style="font-size:${Math.max(10, Number(label.size || 12))}px">${esc(label.name)}</text>${counts[label.name] ? `<text class="home-town-count" y="13" text-anchor="middle">情報 ${counts[label.name]}件</text>` : ""}</g>`).join("")}</g><g class="home-town-markers">${markers}</g></svg><span class="map-caption">海老名市町丁目データを使った軽量概念図</span></div><div class="map-side"><p class="eyebrow">DISCOVER</p><h3>場所から、<br>海老名の変化を見つける。</h3><p>駅前の計画も、暮らしの変化も。町丁目から気になる動きをたどれます。</p><a class="button button--orange" href="/map">町丁目マップをひらく</a></div></div>`;
    }
    const options = areas.towns.map((town) => `<option value="${esc(town.id)}">${esc(town.name)}（${esc(town.base)}エリア）</option>`).join("");
    const markers = data.mapPoints.map((newsPoint) => { const point = projectAreaPoint(newsPoint); return `<g class="svg-event-marker" data-svg-news-point="${esc(newsPoint.id)}" data-map-point-cat="${esc(newsPoint.category)}" transform="translate(${point.svgX} ${point.svgY})" role="button" tabindex="0"><g class="svg-event-marker-inner"><circle class="svg-event-halo" r="12" style="--item-color:${mapPointColor(newsPoint)}"></circle><circle class="svg-event-dot" r="6" style="--item-color:${mapPointColor(newsPoint)}"></circle><text x="13" y="4">${esc(newsPoint.label)}</text></g></g>`; }).join("");
      return `<div class="interactive-map-layout"><div class="interactive-map-card svg-map-card"><svg class="svg-town-map" data-svg-town-map viewBox="${esc(areas.viewBox)}" role="application" aria-label="海老名市の町丁目とニュース地点"><rect class="svg-map-paper" width="700" height="900"></rect><g>${areas.towns.map((town) => `<path class="area-region ${cityPointsForBase(town.base).length ? "has-update" : ""}" d="${esc(town.d)}" data-svg-town data-area-id="${esc(town.id)}" data-area-base="${esc(town.base)}" role="button" tabindex="0"><title>${esc(town.name)}</title></path>`).join("")}</g><path class="area-outline" d="${esc(areas.outline)}"></path><g class="svg-base-labels">${areas.labels.map((label) => `<g data-base-label="${esc(label.name)}" transform="translate(${label.x} ${label.y})"><text text-anchor="middle">${esc(label.name)}</text><text class="svg-base-count" data-base-count="${esc(label.name)}" y="14" text-anchor="middle">情報 ${counts[label.name] || 0}件</text></g>`).join("")}</g><g class="svg-chome-labels">${areas.towns.map((town) => `<g data-chome-label="${esc(town.id)}" transform="translate(${town.cx} ${town.cy})"><text text-anchor="middle">${esc(town.name)}</text></g>`).join("")}</g><g>${markers}</g></svg><div class="svg-map-controls"><button type="button" data-svg-zoom-in aria-label="拡大">＋</button><button type="button" data-svg-zoom-out aria-label="縮小">−</button><button type="button" data-svg-reset aria-label="全体表示">全</button></div><div class="interactive-map-level"><span data-map-level-label>市全体</span><small data-map-level-help>主要地域名・情報件数・ニュース地点</small></div><div class="interactive-map-legend"><span><i class="legend-development"></i>ニュース・開発</span><span><i class="legend-city-news"></i>暮らし・地域情報</span><span><i class="legend-tracking"></i>追跡・交通</span><span><i class="legend-issue"></i>防災</span></div>${previewMode ? `<div class="interactive-map-demo">PREVIEW　SVG概念図／詳細地図は町丁目ページで表示</div>` : ""}</div><aside class="interactive-map-detail" data-map-detail aria-live="polite"><p class="eyebrow">DISCOVER BY PLACE</p><h2>海老名市を場所から見る</h2><p>ニュース地点を押すと記事概要が表示されます。町丁目を選ぶと詳しい地図へ進めます。</p><div class="map-detail-summary"><strong>ニュース地点 ${data.mapPoints.length}件</strong><small>${previewMode ? "画面確認用の情報を含みます" : "公開済みの地点情報を表示しています"}</small></div><div class="map-keyboard-areas"><label for="map-area-select">町丁目を選ぶ</label><select id="map-area-select" data-keyboard-area-select><option value="">町丁目を選択してください</option>${options}</select><button class="button" type="button" data-keyboard-area-open>選択した地域を詳しく見る</button></div></aside></div>`;
  };

  const mapLibreMapView = () => {
    const keyboardAreaOptions = areas.towns
      .map((town) => `<option value="${esc(String(town.id))}">${esc(town.name)}（${esc(town.base)}エリア）</option>`)
      .join("");
    const landmarkButtons = CITY_LANDMARKS.map((landmark) => `<button type="button" data-city-landmark="${esc(landmark.id)}" aria-pressed="false"><span class="city-landmark-chip-icon">${cityLandmarkIllustration(landmark.imagePath)}</span><span>${esc(landmark.name)}</span><small>${esc(landmark.category)}</small></button>`).join("");
    const overviewLandmarks = CITY_LANDMARKS.map((landmark) => { const point = projectAreaPoint(landmark); return `<circle data-city-overview-landmark="${esc(landmark.id)}" cx="${point.svgX}" cy="${point.svgY}" r="14" fill="${esc(landmark.color)}"><title>${esc(landmark.name)}</title></circle>`; }).join("");
    return `<div class="interactive-map-layout">
      <div class="interactive-map-main">
        <nav class="city-landmark-nav" aria-label="海老名市の主な目印へ移動">
          <button class="city-landmark-scroll" type="button" data-city-landmark-scroll="-1" aria-label="前の目印を表示">‹</button>
          <div class="city-landmark-strip" data-city-landmark-strip><button type="button" class="is-active" data-city-landmark="all" aria-pressed="true"><span>海老名市全体</span><small>全体</small></button>${landmarkButtons}</div>
          <button class="city-landmark-scroll" type="button" data-city-landmark-scroll="1" aria-label="次の目印を表示">›</button>
        </nav>
        <div class="interactive-map-card">
          <div id="ebina-interactive-map" class="interactive-map" role="application" aria-label="ズームすると情報が詳しくなる海老名市の地図"></div>
          <div class="interactive-map-loading" data-interactive-map-loading><span></span><strong>町丁目地図を準備しています</strong><small>初回のみ地図機能を読み込みます</small></div>
          <div class="interactive-map-level"><span data-map-level-label>市全体</span><small data-map-level-help>主要地域名とニュース地点</small></div>
          <div class="city-overview-map"><strong>市全体</strong><svg data-city-overview viewBox="${esc(areas.viewBox)}" role="application" tabindex="0" aria-label="海老名市全体図。押した位置へ地図を移動できます"><rect class="city-overview-paper" width="700" height="900"></rect><g class="city-overview-areas">${areas.towns.map((town) => `<path d="${esc(town.d)}"></path>`).join("")}</g><path class="city-overview-outline" d="${esc(areas.outline)}"></path><g class="city-overview-landmarks">${overviewLandmarks}</g><rect class="city-overview-window" data-city-overview-window x="0" y="0" width="700" height="900"></rect></svg><button type="button" data-city-overview-fit>全体へ戻る</button></div>
          <div class="interactive-map-legend" aria-label="地図の凡例"><span><i class="legend-development"></i>開発中</span><span><i class="legend-complete"></i>完成済み</span><span><i class="legend-issue"></i>地域課題</span></div>
          ${previewMode ? `<div class="interactive-map-demo">PREVIEW　高倍率の詳細背景は検証用です</div>` : ""}
        </div>
      </div>
      <aside class="interactive-map-detail" data-map-detail aria-live="polite">
        <p class="eyebrow">INTERACTIVE MAP</p><h2>海老名市を選んで見る</h2><p>町を選ぶと滑らかに拡大します。さらに拡大すると、丁目、道路・建物、地点情報が順に表示されます。</p>
        <div class="map-detail-guide"><span><b>1</b>市全体</span><span><b>2</b>町丁目</span><span><b>3</b>道路・建物</span><span><b>4</b>地点詳細</span></div>
        <div class="map-detail-summary"><strong>掲載地点 ${data.mapItems.length + data.mapPoints.length}件</strong><small>${previewMode ? "画面確認用の情報を含みます" : "公開済みの地点情報を表示しています"}</small></div>
        <div class="map-keyboard-areas"><label for="map-area-select">キーボードで町丁目を選ぶ</label><select id="map-area-select" data-keyboard-area-select><option value="">町丁目を選択してください</option>${keyboardAreaOptions}</select><button class="button" type="button" data-keyboard-area-open>選択した地域を詳しく見る</button></div>
      </aside>
    </div>`;
  };

  const mapView = (compact = false) => compact ? svgMapView(true) : mapLibreMapView();

  const header = () => `
    ${previewMode ? `<div class="demo-bar">${liveNews ? "PREVIEW　公開ニュースと確認用デモコンテンツを表示しています。" : publicState.mode === "empty" ? "PREVIEW　公開記事は現在0件です。確認用デモコンテンツを表示しています。" : "PREVIEW　掲載情報は画面確認用のデモです。"}</div>` : publicState.mode === "error" ? `<div class="demo-bar">現在、公開情報を取得できません。時間をおいて再度お試しください。</div>` : ""}
    <header class="site-header">
      <div class="shell header-main">
        <a class="brand" href="/" aria-label="海老名びより ホーム">
          <span><span class="brand-name">海老名びより</span><span class="brand-sub">海老名の変化を、知る。追う。参加する。</span></span>
        </a>
        <nav class="desktop-nav" aria-label="メインナビゲーション">
          <a href="/news">ニュース</a><a href="/map">まちマップ</a><a href="/followups">その後どうなった？</a><a href="/tips">情報提供</a><a href="/feedback">改善要望</a><a href="/about">このサイトについて</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button search-toggle" type="button" aria-label="検索を開く" aria-controls="site-search-dialog" aria-expanded="false">⌕</button>
          <button class="icon-button menu-button" type="button" aria-label="メニューを開く" aria-expanded="false">☰</button>
        </div>
      </div>
      <nav class="shell mobile-menu" aria-label="モバイルナビゲーション">
        <a href="/news">ニュース</a><a href="/map">まちマップ</a><a href="/followups">その後どうなった？</a><a href="/tips">情報提供</a><a href="/feedback">改善要望</a><a href="/about">このサイトについて</a>
      </nav>
    </header>
    <div class="search-panel" id="site-search-dialog" role="dialog" aria-modal="true" aria-labelledby="site-search-title" aria-hidden="true">
      <div class="search-box">
        <div class="search-box-top"><strong id="site-search-title">サイト内を検索</strong><button class="icon-button search-close" type="button" aria-label="検索を閉じる">×</button></div>
        <form class="search-form" data-search-form><input class="search-input" name="q" type="search" aria-label="検索キーワード" placeholder="ニュース、追跡、町丁目、地図情報を検索" required><button class="button" type="submit">検索する</button></form>
      </div>
    </div>`;

  const footer = () => `
    <footer class="site-footer">
      <div class="shell">
        <div class="footer-grid">
          <div class="footer-brand"><a class="brand" href="/"><span><span class="brand-name">海老名びより</span><span class="brand-sub">海老名の変化を、知る。追う。参加する。</span></span></a><p class="footer-note">${previewMode ? liveNews ? "海老名市公式ではない独立サイトです。公開ニュースに加え、画面確認用のデモコンテンツを表示しています。" : "海老名市公式ではない独立サイトです。プレビューの掲載情報はすべて架空です。" : "海老名市公式ではない独立サイトです。公開情報は情報元と確認日を添えて掲載します。"}</p></div>
          <div><p class="footer-title">コンテンツ</p><div class="footer-links"><a href="/news">ニュース一覧</a><a href="/map">海老名まちマップ</a><a href="/followups">その後どうなった？</a><a href="/tips">情報提供</a></div></div>
          <div><p class="footer-title">サイト運営</p><div class="footer-links"><a href="/about">このサイトについて</a><a href="/editorial">編集方針</a><a href="/feedback">改善要望</a><a href="/corrections">訂正依頼</a><a href="/privacy">プライバシーポリシー</a></div></div>
        </div>
        <div class="copyright">© 2026 海老名びより${previewMode ? "（プレビュー）" : ""}</div>
      </div>
    </footer>`;

  const layout = (content) => `${header()}<main id="main-content">${content}</main>${footer()}`;
  const breadcrumb = (items) => `<div class="shell breadcrumb"><a href="/">ホーム</a>${items.map((item) => `　/　${item.href ? `<a href="${href(item.href)}">${esc(item.label)}</a>` : esc(item.label)}`).join("")}</div>`;
  const pageHero = (eyebrow, title, lead, modifier = "") => `<section class="page-hero ${esc(modifier)}"><div class="shell"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${lead ? `<p>${esc(lead)}</p>` : ""}</div>${["page-hero--pickup", "page-hero--followups"].includes(modifier) ? `<span class="page-hero-image-note">イメージイラスト／実際の景観・建物配置を示すものではありません</span>` : ""}</section>`;

  function homePage() {
    const important = data.news.filter((n) => n.important).slice(0, 3);
    const featuredNews = important[0] || (previewMode ? data.news[0] : null);
    const featuredFollowup = data.followups[0];
    const latestNews = liveNews ? data.news.filter((item) => item !== featuredNews).slice(0, 6) : data.news.slice(3, 9);
    const pickupFeature = featuredNews
      ? `<a class="editorial-feature-card" href="${href("/pickup")}"><div class="editorial-feature-image editorial-feature-image--sky"><span class="editorial-image-note">イメージイラスト</span></div><div class="editorial-feature-body"><p class="editorial-feature-type editorial-feature-type--navy"><span>選</span>海老名ピックアップ</p><h3>${esc(featuredNews.title)}</h3><time>${esc(featuredNews.checkedAt)}</time><b aria-hidden="true">→</b></div></a>`
      : `<div class="editorial-feature-card editorial-feature-card--empty"><div class="editorial-feature-image editorial-feature-image--sky"><span class="editorial-image-note">イメージイラスト</span></div><div class="editorial-feature-body"><p class="editorial-feature-type editorial-feature-type--navy"><span>選</span>海老名ピックアップ</p><h3>ピックアップ記事を準備しています</h3><time>公開までお待ちください</time></div></div>`;
    const followupFeature = featuredFollowup
      ? `<a class="editorial-feature-card" href="${href("/followups")}"><div class="editorial-feature-image editorial-feature-image--river"><span class="editorial-image-note">イメージイラスト</span></div><div class="editorial-feature-body"><p class="editorial-feature-type editorial-feature-type--red"><span>追</span>その後、どうなった？</p><h3>${esc(featuredFollowup.title)}</h3><time>${esc(featuredFollowup.updatedAt)}</time><b aria-hidden="true">→</b></div></a>`
      : `<div class="editorial-feature-card editorial-feature-card--empty"><div class="editorial-feature-image editorial-feature-image--river"><span class="editorial-image-note">イメージイラスト</span></div><div class="editorial-feature-body"><p class="editorial-feature-type editorial-feature-type--red"><span>追</span>その後、どうなった？</p><h3>追跡レポートを準備しています</h3><time>公開までお待ちください</time></div></div>`;
    return layout(`
      <section class="editorial-hero">
        <div class="editorial-shell">
          <div class="editorial-hero-art">
            <div class="editorial-hero-copy"><p>海老名</p><h1 class="editorial-pickup-title">びより</h1><div class="editorial-rule"><i></i><i></i></div><h2>まちのいまを見つめ、<br>未来の景色を一緒につくる。</h2></div>
            <p class="editorial-vertical-copy">まちの輪郭をたどると、いつもの景色に新しい変化が見えてくる。</p>
            <span class="editorial-art-note">イメージイラスト／実際の景観・建物配置を示すものではありません</span>
          </div>
          <div class="editorial-feature-grid">
            ${pickupFeature}
            ${followupFeature}
          </div>
        </div>
      </section>
      <section class="section section--white"><div class="shell"><div class="section-head"><div><p class="eyebrow">CATEGORY</p><h2 class="section-title">カテゴリーから探す</h2></div></div><div class="category-grid">${data.categories.map((c) => `<a class="category-card" href="/news?category=${c.id}"><span class="category-icon">${c.icon}</span>${c.label}</a>`).join("")}</div></div></section>
      <section class="section map-home-section"><div class="shell"><div class="section-head"><div><p class="eyebrow">EBINA TOWN MAP</p><h2 class="section-title">海老名まちマップ</h2><p class="section-lead">「何のニュース？」だけでなく、「どこで起きている？」から探せます。</p></div></div>${mapView(true)}</div></section>
      <section class="section"><div class="shell"><div class="section-head"><div><p class="eyebrow">LATEST NEWS</p><h2 class="section-title">最新ニュース</h2></div><a class="text-link" href="/news">ニュースをすべて見る →</a></div><div class="news-grid">${latestNews.length ? latestNews.map(newsCard).join("") : `<div class="empty-state"><h2>${data.news.length ? "ほかの公開ニュースはまだありません" : "公開中のニュースはまだありません"}</h2><p>確認が完了した情報から順次掲載します。</p></div>`}</div></div></section>
      <section class="section section--tint"><div class="shell"><div class="section-head"><div><p class="eyebrow">FOLLOW UP</p><h2 class="section-title">その後、どうなった？</h2><p class="section-lead">発表された計画を、発表時だけで終わらせず時系列で追います。</p></div><a class="text-link" href="/followups">追跡テーマをすべて見る →</a></div><div class="followup-list">${data.followups.length ? data.followups.slice(0, 4).map(followupRow).join("") : `<div class="empty-state"><h2>公開中の追跡レポートはまだありません</h2><p>継続確認するテーマが決まり次第掲載します。</p></div>`}</div></div></section>
      <section class="section"><div class="shell"><div class="data-strip"><div class="data-intro"><p class="eyebrow" style="color:#f7ad73">DATA</p><h2>データで見る海老名</h2><p style="font-size:.78rem;color:#d4e4e2">${previewMode ? "現在は確認用プレビューです" : "公開情報をデータベースから取得しています"}</p></div><div class="data-item"><p class="data-value">${data.news.length}件</p><p class="data-label">${previewMode && !liveNews ? "デモニュース" : "公開ニュース"}</p></div><div class="data-item"><p class="data-value">${data.followups.length}件</p><p class="data-label">${previewMode && !liveFollowups ? "確認用の追跡テーマ" : "公開中の追跡テーマ"}</p></div></div></div></section>
      <section class="section section--white"><div class="shell"><div class="tip-cta"><div><p class="eyebrow" style="color:#f7ad73">INFORMATION</p><h2>海老名の変化を教えてください</h2><p>工事のお知らせ、開店・閉店、暮らしの変化など。いただいた情報は編集部が確認し、即時公開はしません。</p></div><a class="button button--orange" href="/tips">情報提供について見る</a></div></div></section>`);
  }

  function newsListPage(params) {
    const selected = params.get("category") || "all";
    const list = selected === "all" ? data.news : data.news.filter((n) => n.category === selected);
    return layout(`${pageHero("NEWS", "ニュース", "いま海老名で起きていることを、情報元と確認日を添えて伝えます。")}
      <section class="section"><div class="shell"><div class="filter-bar"><button class="filter-button ${selected === "all" ? "is-active" : ""}" data-category="all">すべて</button>${data.categories.map((c) => `<button class="filter-button ${selected === c.id ? "is-active" : ""}" data-category="${c.id}">${c.label}</button>`).join("")}</div><p class="list-count">${list.length}件の${previewMode && !liveNews ? "デモ記事" : "公開記事"}</p><div class="news-grid">${list.length ? list.map(newsCard).join("") : `<div class="empty-state"><h2>該当するニュースはまだありません</h2><p>確認が完了した情報から順次掲載します。</p></div>`}</div></div></section>`);
  }

  function pickupPage() {
    const list = data.news.filter((item) => item.important);
    return layout(`${pageHero("EBINA PICKUP", "海老名ピックアップ", "いま知っておきたい海老名の動きを、編集部が選んで紹介します。", "page-hero--pickup")}
      <section class="section"><div class="shell"><p class="list-count">${list.length}件のピックアップ</p><div class="news-grid">${list.length ? list.map(newsCard).join("") : `<div class="empty-state"><h2>ピックアップ記事を準備しています</h2><p>編集部が選定した記事を順次掲載します。</p></div>`}</div></div></section>`);
  }

  function mapPage() {
    const mapCategories = [...new Set([...data.mapPoints, ...data.mapItems].map((point) => point.category))];
    const savedState = readMapState();
    const navigationType = window.performance?.getEntriesByType?.("navigation")?.[0]?.type;
    const isReload = navigationType === "reload" || window.performance?.navigation?.type === 1;
    const restoreRequested = !isReload && savedState?.restoreOnce === true && (window.ebinaRestoreRequested === true || window.history?.state?.ebinaMapRestore === true);
    window.ebinaRestoreMapOnRender = restoreRequested;
    const selectedCategory = restoreRequested ? savedState?.category || "all" : "all";
    window.ebinaPendingMapCategory = selectedCategory;
    return layout(`${pageHero("EBINA TOWN MAP", "海老名まちマップ", "海老名のどこで、どんな変化が動いているか。場所を入口にニュースや追跡テーマを探せます。")}
      <section class="section map-page-section"><div class="shell"><div class="map-demo-note"><span>SEMANTIC ZOOM</span><p><strong>拡大に合わせて、市全体 → 町名 → 町丁目 → 道路・建物 → 地点情報の順に詳しくなります。</strong><br>町丁目境界は同梱データ、詳細背景はズーム13.6以上で国土地理院の淡色タイルを読み込みます。</p></div><div class="filter-bar map-filters"><button class="filter-button ${selectedCategory === "all" ? "is-active" : ""}" data-map-filter="all">すべて</button>${mapCategories.map((id) => `<button class="filter-button ${selectedCategory === id ? "is-active" : ""}" data-map-filter="${id}">${esc(categoryMap[id])}</button>`).join("")}</div><p class="map-operation-note">地域をクリックすると概要を表示します。詳しく見るボタン、またはダブルクリックで地域ページを開けます。</p>${mapView(false)}<div class="map-rights-note"><span>境界：<a href="https://geoshape.ex.nii.ac.jp/ka/resource/14215.html" target="_blank" rel="noopener">国勢調査町丁・字等別境界データセット</a>（CC BY 4.0／2020年）</span><span>詳細背景：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（国土地理院）</a>・検証利用</span></div></div></section>`);
  }

  const mapItemType = (item) => {
    if (item.status === "地域課題") return "海老名の課題";
    if (["工事中", "完成", "正式決定", "着工"].includes(item.status)) return "開発・工事";
    if (["検討中", "続報待ち"].includes(item.status)) return "その後、どうなった？";
    return "ニュース";
  };

  const guideProgressForArea = (areaId, guideArea) => {
    const saved = guideData.statuses?.[String(areaId)] || null;
    const status = saved?.status || (guideArea ? "building" : "not_started");
    const defaults = {
      not_started: { label: "準備中", title: "編集部の手作り案内図は、ただいま準備中です", message: "この町丁目の目印や歩き方を調べています。" },
      building: { label: "β版・更新中", title: "この案内図は編集部が制作を進めています", message: "掲載している施設や道順はまだ一部です。順次追加・調整します。" },
      review: { label: "公開前確認中", title: "案内図の最終確認を進めています", message: "位置や名称を確認し、準備が整い次第公開します。" },
      published: { label: "公開中", title: "編集部の手作り案内図を公開しています", message: "街の変化に合わせて内容を更新します。" },
    };
    const copy = defaults[status] || defaults.not_started;
    const updated = saved?.updatedAt ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(saved.updatedAt)) : "";
    return { status, ...copy, message: saved?.message || copy.message, updated };
  };

  const guideProgressNotice = (areaId, guideArea) => {
    const progress = guideProgressForArea(areaId, guideArea);
    return `<aside class="public-guide-progress is-${esc(progress.status)}"><div><span>${esc(progress.label)}</span><div><strong>${esc(progress.title)}</strong><p>${esc(progress.message)}</p></div></div><footer>${progress.updated ? `<small>最終更新 ${esc(progress.updated)}</small>` : `<small>制作状況は随時更新します</small>`}<a href="/tips">この場所も載せてほしい →</a></footer></aside>`;
  };

  function areaDetailPage(id) {
    const props = areaTown(id);
    if (!props) return notFoundPage();
    const guideArea = guideData.areas[String(props.id)] || null;
    const guideProgress = guideProgressForArea(props.id, guideArea);
    const mapMode = guideArea && window.ebinaAreaMapMode === "editorial" ? "editorial" : "standard";
    const editorialMapActive = mapMode === "editorial";
    const detailMapDescription = editorialMapActive ? "編集部が道路・目印・建物・入口・おすすめ経路を組み立てた手作り案内図です。" : "道路、建物、鉄道、周辺施設を確認できる通常地図です。";
    const detailMapCredit = editorialMapActive ? `${liveGuide ? "登録場所：海老名びより編集部／" : ""}手作り案内図／位置・形状・おすすめ経路は案内用の概略表示` : "背景：地理院標準地図／選択範囲：朱色の輪郭";
    const sharedUpdates = areaSharedUpdates(id);
    const sharedUpdateContent = sharedUpdates.length ? `<div class="area-update-filters" role="group" aria-label="地域情報を絞り込む"><button type="button" class="is-active" data-area-update-filter="all">すべて</button><button type="button" data-area-update-filter="news">ニュース</button><button type="button" data-area-update-filter="followup">その後、どうなった？</button></div><div class="area-update-list">${sharedUpdates.map((item) => `<a href="${href(item.target)}" data-area-update-type="${item.type}"><span style="--update-color:${item.color}"></span><small>${esc(item.kind)}</small><strong>${esc(item.title)}</strong><time>${esc(item.date)}</time></a>`).join("")}</div>` : `<div class="area-update-empty"><strong>現在掲載中の動きはありません</strong><p>ニュースや追跡レポートが登録されると、地図とこの一覧へ表示されます。</p></div>`;
    const guideMapSupplement = `<aside class="guide-map-selection area-update-panel" data-guide-map-detail aria-live="polite"><p class="eyebrow">AREA UPDATES</p><h3>この町丁目の動き</h3><p>地図の種類を切り替えても、同じニュースと追跡レポートを確認できます。</p>${sharedUpdateContent}</aside>`;
    const splitMapLayout = true;
    const editorialMapButton = guideArea ? `<button type="button" data-area-map-mode="editorial" class="${editorialMapActive ? "is-active" : ""}" aria-pressed="${editorialMapActive ? "true" : "false"}">編集部の手作り案内図${guideProgress.status === "published" ? "" : "（β版）"}</button>` : `<button type="button" disabled aria-disabled="true" title="この町丁目の手作り案内図は${esc(guideProgress.label)}です">編集部の手作り案内図（${esc(guideProgress.label)}）</button>`;
    const mapModeSwitch = `<div class="area-map-mode-switch" role="group" aria-label="地図の表示を切り替える"><button type="button" data-area-map-mode="standard" class="${editorialMapActive ? "" : "is-active"}" aria-pressed="${editorialMapActive ? "false" : "true"}">通常地図</button>${editorialMapButton}</div>`;
    const items = areaItems(id);
    const recent = items.flatMap((item) => item.history.map((entry) => ({ ...entry, title: item.title }))).sort((a, b) => String(b.date).localeCompare(String(a.date), "ja")).slice(0, 5);
    const areaSqm = Number(props.area || 0);
    const areaNotice = previewMode
      ? liveGuide ? `<strong>案内図の登録場所は編集部の公開データです。</strong> 人口・世帯数は2020年の境界データ、計画など一部の地域情報は確認用表示です。` : `<strong>地域情報はプレビュー表示です。</strong> 地図上の計画や出来事は画面確認用の架空情報です。`
      : liveGuide ? `<strong>案内図の登録場所は編集部の公開データです。</strong> 人口・世帯数は2020年の境界データを使用しています。` : `<strong>基本情報を表示しています。</strong> 人口・世帯数は2020年の境界データを使用しています。`;
    const related = items.length ? `<div class="area-related-grid">${items.map((item) => `<article class="area-related-card"><div><span class="map-detail-demo">デモデータ</span><span class="status" data-status="${esc(item.status)}">${esc(item.status)}</span></div><p class="eyebrow">${esc(mapItemType(item))}</p><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${item.relatedArticles.map((article) => `<a class="text-link" href="${href(article.href)}">${esc(article.label)} →</a>`).join("")}</article>`).join("")}</div>` : `<div class="area-empty"><h2>現在掲載されている情報はありません</h2><p>この町丁目に紐づくニュース、計画、工事、地域課題はまだ登録されていません。</p><a class="button button--orange" href="/tips">この地域の情報を提供する</a></div>`;
    return layout(`${breadcrumb([{ label: "まちマップ", href: "/map" }, { label: `${props.base}エリア` }, { label: props.name }])}
      <section class="area-detail-hero"><div class="shell"><p class="eyebrow">AREA PROFILE / ${esc(String(props.id))}</p><h1>${esc(props.name)}</h1><p>${esc(props.base)}エリア</p><div class="demo-notice">${areaNotice}</div></div></section>
      <section class="section area-profile-section"><div class="shell area-profile-layout"><div class="area-detail-map-block"><div class="area-detail-map-heading"><p class="eyebrow">PLACE GUIDE</p><h2>${esc(props.name)}の案内絵図</h2><p>${esc(detailMapDescription)}</p>${guideProgressNotice(props.id, guideArea)}${mapModeSwitch}</div><div class="${splitMapLayout ? "guide-map-layout" : ""}"><div class="area-mini-map-wrap"><div id="area-mini-map" class="area-mini-map" data-area-id="${esc(String(props.id))}" data-map-mode="${mapMode}" role="application" aria-label="${esc(props.name)}の${editorialMapActive ? "編集部の手作り案内図" : "通常地図"}"></div><div class="area-mini-loading" data-area-mini-loading>${editorialMapActive ? "手作り案内図" : "通常地図"}を準備しています</div><button class="area-map-fit-button" type="button" data-area-map-fit aria-label="${esc(props.name)}全体を地図に表示する">町丁目全体を表示</button>${editorialMapActive ? `<div class="guide-map-legend" aria-label="手作り案内図の凡例"><span><i class="is-road"></i>主要道路</span><span><i class="is-rail"></i>鉄道</span><span><i class="is-place"></i>登録場所</span></div>` : ""}<small>${esc(detailMapCredit)}</small></div>${guideMapSupplement}</div></div><div class="area-profile-overview"><div class="area-profile-stats"><div><small>人口</small><strong>${Number(props.population || 0).toLocaleString("ja-JP")}人</strong></div><div><small>世帯数</small><strong>${Number(props.households || 0).toLocaleString("ja-JP")}世帯</strong></div><div><small>面積</small><strong>${(areaSqm / 1000000).toFixed(3)} km²</strong><span>${areaSqm.toLocaleString("ja-JP")} m²</span></div><div><small>データ基準年</small><strong>2020年</strong></div></div><div class="area-source-box"><strong>基本情報の情報源</strong><p>国勢調査町丁・字等別境界データセット（2020年）。人口・世帯数・面積は同梱された町丁目境界データの値です。</p><a href="https://geoshape.ex.nii.ac.jp/ka/resource/14215.html" target="_blank" rel="noopener">情報源を確認する →</a></div></div></div></section>
      <section class="section section--white"><div class="shell"><div class="section-head"><div><p class="eyebrow">RELATED UPDATES</p><h2 class="section-title">この地域に関係する情報</h2></div></div>${related}</div></section>
      <section class="section area-history-section"><div class="shell"><div class="section-head"><div><p class="eyebrow">RECENT ACTIVITY</p><h2 class="section-title">更新履歴・最近の動き</h2></div></div>${recent.length ? `<div class="area-history-list">${recent.map((entry) => `<div><time>${esc(entry.date)}</time><span>${esc(entry.status)}</span><h3>${esc(entry.title)}</h3><p>${esc(entry.note)}</p></div>`).join("")}</div>` : `<p class="map-detail-empty">現在掲載されている更新履歴はありません。</p>`}<div class="area-back-actions"><a class="button" href="/map" data-map-restore aria-label="直前の表示位置で海老名まちマップに戻る">← 地図に戻る</a><a class="text-link" href="/tips">この地域の情報を提供する →</a></div></div></section>`);
  }

  function newsDetailPage(id) {
    const item = data.news.find((n) => n.id === id);
    if (!item) return notFoundPage();
    const sourceRows = item.sources?.length ? item.sources : [{ type: item.sourceType, name: item.source, url: item.sourceUrl || "", checkedAt: item.checkedAt }];
    const sourceMarkup = sourceRows.map((source) => `<p><span class="tag tag--source">${esc(source.type)}</span></p><p>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)} →</a>` : esc(source.name)}${source.checkedAt ? `<br><small class="muted">確認 ${esc(source.checkedAt)}</small>` : ""}</p>`).join("");
    return layout(`${breadcrumb([{ label: "ニュース", href: "/news" }, { label: item.title }])}${pageHero(categoryMap[item.category], item.title, item.excerpt)}
      <article class="article"><div class="narrow">${liveNews ? "" : `<div class="demo-notice"><strong>デモ情報です</strong><br>この記事は画面確認用の架空情報です。実際の行政・店舗・地域情報として利用しないでください。</div>`}<div class="article-meta"><div class="meta-item"><span class="meta-label">発表日</span>${esc(item.publishedAt)}</div><div class="meta-item"><span class="meta-label">サイトでの最終確認日</span>${esc(item.checkedAt)}</div><div class="meta-item"><span class="meta-label">情報の区分</span>${esc(item.sourceType)}</div><div class="meta-item"><span class="meta-label">カテゴリー</span>${esc(categoryMap[item.category])}</div></div><div class="article-body">${window.EBINA_ARTICLE_FORMAT?.render(Array.isArray(item.body) ? item.body.join("\n\n") : item.body) || item.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div><div class="source-box"><h2>情報元</h2>${sourceMarkup}${liveNews ? "" : `<p class="muted">本番運用では、確認可能な一次情報へのリンクと確認内容を掲載します。</p>`}</div><div class="source-box"><h2>訂正履歴</h2><p class="muted">訂正はありません。訂正が生じた場合は、変更日・変更箇所・理由をここに記録します。</p><a class="text-link" href="/corrections">訂正を依頼する →</a></div></div></article>`);
  }

  function followupsPage() {
    return layout(`${pageHero("FOLLOW UP", "その後、どうなった？", "発表された開発や計画の現在地を、状態と時系列で追跡します。", "page-hero--followups")}<section class="section section--tint"><div class="shell"><p class="list-count">追跡テーマ ${data.followups.length}件${previewMode && !liveFollowups ? "（確認用データ）" : ""}</p><div class="followup-list">${data.followups.length ? data.followups.map(followupRow).join("") : `<div class="empty-state"><h2>公開中の追跡レポートはまだありません</h2><p>継続確認するテーマが決まり次第掲載します。</p></div>`}</div></div></section>`);
  }

  function followupDetailPage(id) {
    const item = data.followups.find((n) => n.id === id);
    if (!item) return notFoundPage();
    const timeline = item.timeline?.length ? item.timeline.map((entry) => `<div class="timeline-item"><span class="timeline-date">${esc(entry.date)}　/　${esc(entry.status)}</span><h3>${entry.href ? `<a href="${href(entry.href)}">${esc(entry.title)}</a>` : esc(entry.title)}</h3><p>${esc(entry.text)}</p></div>`).join("") : `<div class="empty-state"><h3>公開済みの関連記事はまだありません</h3><p>新しい記事がこの追跡テーマに紐づくと、ここへ時系列で追加されます。</p></div>`;
    return layout(`${breadcrumb([{ label: "その後、どうなった？", href: "/followups" }, { label: item.title }])}<section class="page-hero"><div class="shell"><p class="eyebrow">${esc(item.category)} / TRACKING</p><div style="margin-bottom:15px">${status(item.status)}</div><h1>${esc(item.title)}</h1><p>${esc(item.summary)}</p></div></section><article class="article"><div class="narrow">${liveFollowups ? "" : `<div class="demo-notice"><strong>架空の追跡テーマです。</strong> 実在する計画や進捗ではありません。</div>`}<div class="next-check"><strong>次に確認すること</strong>${esc(item.nextCheck)}<br><span class="muted">サイトでの最終確認：${esc(item.updatedAt)}</span></div><h2>これまでの動き</h2><div class="timeline">${timeline}</div><div class="source-box"><h2>状態の見方</h2><p>構想 → 検討中 → 正式決定 → 着工 → 工事中 → 完成を基本に、延期・中止・続報待ちも表示します。発表内容に応じて状態は前後する場合があります。</p></div></div></article>`);
  }

  function issuesPage() {
    return layout(`${pageHero("LOCAL ISSUES", "海老名の課題", "課題を先に断定せず、確認すべき事実、データ、当事者の声を整理します。")}<section class="section"><div class="shell"><div class="demo-notice">現在掲載している2件は、調査ページの構成を確認するためのデモ課題です。</div><div class="issue-grid">${data.issues.map(issueCard).join("")}</div></div></section>`);
  }

  function issueDetailPage(id) {
    const item = data.issues.find((n) => n.id === id);
    if (!item) return notFoundPage();
    return layout(`${breadcrumb([{ label: "海老名の課題", href: "/issues" }, { label: item.title }])}${pageHero(item.kicker, item.title, item.summary)}<article class="article"><div class="narrow"><div class="demo-notice">${esc(item.note)}</div><p><span class="tag tag--orange">現在地：${esc(item.stage)}</span></p><div class="evidence-grid"><section class="evidence-box"><h2>確認する事実・データ</h2><ul>${item.facts.map((v) => `<li>${esc(v)}</li>`).join("")}</ul></section><section class="evidence-box"><h2>聞きたい当事者の声</h2><ul>${item.voices.map((v) => `<li>${esc(v)}</li>`).join("")}</ul></section></div><div class="source-box"><h2>この調査で大切にすること</h2><p>一部の声だけで地域全体の課題と決めつけません。公開データ、現地確認、立場の異なる当事者の声を照合し、分からないことも明記します。</p></div></div></article>`);
  }

  const infoPages = {
    about: ["ABOUT", "このサイトについて", "海老名びよりは、海老名の変化を継続して確認する独立地域メディアです。", `<h2>目指すこと</h2><ol><li>今、海老名で何が起きているか分かる</li><li>過去に発表された開発や計画の、その後が分かる</li><li>将来的に市民プロジェクトへの参加につなげる</li></ol><h2>独立したサイトです</h2><p>海老名市公式ではありません。行政、企業、店舗、団体などから独立した立場で、情報元と確認過程を示します。</p><div class="policy-links"><a class="policy-link" href="/editorial">編集方針 →</a><a class="policy-link" href="/privacy">プライバシーポリシー →</a></div>`],
    editorial: ["EDITORIAL POLICY", "編集方針", "信頼できる地域情報のために、確認方法と公開ルールを明らかにします。", `<h2>情報の確認</h2><ul><li>情報元を必ず表示します。</li><li>情報の発表日と、サイトでの最終確認日を分けます。</li><li>行政公式、企業・店舗公式、独自確認、市民提供を区別します。</li><li>不明点や未確認事項は、断定せずその旨を記載します。</li></ul><h2>市民提供情報</h2><p>提供された内容は即時公開しません。公開情報や現地状況を確認し、必要に応じて提供者へ追加確認したうえで編集部が掲載を判断します。</p><h2>画像とコメント</h2><p>写真ではなくイメージイラストを使用する場合は、その旨を画像の近くに明記します。イメージイラストは記事の雰囲気を伝えるためのもので、実際の景観、建物配置、人物、計画内容を示す証拠として使用しません。実在する個人の本人画像と誤認される表現も使用しません。また、コメント欄や自由投稿欄は設けません。</p><h2>訂正</h2><p>誤りが確認された場合は速やかに訂正し、記事内に訂正日、変更内容、理由を記録します。</p>`],
    privacy: ["PRIVACY", "プライバシーポリシー", "情報提供やお問い合わせで預かる情報の扱いを定めます。", `<h2>取得する情報</h2><p>情報提供・訂正依頼・改善要望の内容を取得します。氏名、ニックネーム、連絡先は任意で、匿名でも送信できます。</p><h2>利用目的</h2><ul><li>提供内容の事実確認</li><li>連絡先が入力された場合の追加質問や掲載可否の連絡</li><li>サイト品質の改善</li></ul><h2>公開について</h2><p>提供者の連絡先を本人の同意なく公開しません。提供内容を記事で使用する場合も、個人を特定する情報の扱いを事前に確認します。</p><h2>${previewMode ? "プレビューについて" : "保存と管理"}</h2><p>${previewMode ? "ローカルプレビューでは送信機能を動かさず、入力内容も保存しません。" : "受付情報は事実確認と連絡のために必要な期間だけ保管し、管理者だけが確認できる状態で管理します。"}</p>`],
  };

  function infoPage(key) {
    const [eye, title, lead, body] = infoPages[key];
    return layout(`${pageHero(eye, title, lead)}<article class="article"><div class="narrow prose">${body}</div></article>`);
  }

  function formPage(type) {
    const correction = type === "corrections";
    const feedback = type === "feedback";
    const title = correction ? "訂正依頼" : feedback ? "改善要望" : "情報提供";
    const lead = correction ? "掲載内容の誤りや更新が必要な情報をお知らせください。" : feedback ? "使いにくいところや追加してほしい機能など、サイトへのご意見をお寄せください。" : "工事、開店・閉店、地域の変化など、確認してほしい情報をお寄せください。";
    const submissionReady = previewMode || Boolean(publicConfig.supabaseUrl && publicConfig.supabaseAnonKey && publicConfig.turnstileSiteKey);
    let notice = previewMode
      ? `<div class="demo-notice"><strong>プレビュー用フォームです。</strong> 入力内容は送信・保存されません。</div>`
      : submissionReady ? `<div class="form-security-note"><strong>内容は管理画面へ安全に送信されます。</strong><span>送信された情報がそのまま公開されることはありません。</span></div>` : `<div class="demo-notice"><strong>現在、受付機能を準備しています。</strong> 設定完了後に送信できるようになります。</div>`;
    notice = feedback
      ? `<div class="source-box"><h2>海老名の地域情報はこちら</h2><p>工事、開店・閉店、地域の変化などは情報提供フォームから送信できます。</p><a class="button button--orange" href="/tips">地域の情報を提供する</a></div>${notice}`
      : `<div class="source-box"><h2>サイトへの改善要望はこちら</h2><p>使いにくいところや追加してほしい機能は、匿名の改善要望フォームから送信できます。</p><a class="button button--orange" href="/feedback">改善要望を送る</a></div>${notice}`;
    const categoryOptions = feedback ? ["使いにくい", "追加してほしい", "表示がおかしい", "データの問題", "その他"] : ["開発・工事", "開店・閉店", "交通", "イベント", "暮らし", "その他"];
    const standardFields = `<div class="form-field"><label for="title">${feedback ? "改善要望の件名" : "情報の件名"}</label><input class="form-control" id="title" name="title" minlength="3" maxlength="240" required></div><div class="form-field"><label for="kind">${feedback ? "改善の種類" : "情報の種類"}</label><select class="form-control" id="kind" name="category">${categoryOptions.map((value) => `<option>${value}</option>`).join("")}</select></div>${feedback ? "" : `<div class="form-field"><label for="source-url">確認できるURL</label><input class="form-control" id="source-url" name="sourceUrl" type="url" placeholder="https://" maxlength="1000"><small>公式ページなどがあれば入力してください。</small></div>`}`;
    const messageLabel = correction ? "訂正が必要と思われる内容" : feedback ? "改善してほしい内容" : "提供内容";
    const messageHelp = feedback ? "困った操作や、こうなると使いやすいという内容を具体的に記載してください。" : "場所、日時、確認方法などをできるだけ具体的に記載してください。";
    return layout(`${pageHero(correction ? "CORRECTION" : feedback ? "FEEDBACK" : "INFORMATION", title, lead)}<section class="article"><div class="narrow">${notice}<div class="form-card"><form data-submission-form data-submission-type="${correction ? "correction" : feedback ? "feedback" : "information"}"><div class="form-field"><label for="name">お名前またはニックネーム（任意）</label><input class="form-control" id="name" name="senderName" autocomplete="name" maxlength="120"><small>匿名で送信できます。</small></div><div class="form-field"><label for="email">連絡先メールアドレス（任意）</label><input class="form-control" id="email" name="senderContact" type="email" autocomplete="email" maxlength="254"><small>返信が必要な場合だけ入力してください。公開しません。</small></div>${correction ? `<div class="form-field"><label for="source-url">対象ページ</label><input class="form-control" id="source-url" name="sourceUrl" type="url" placeholder="https://" maxlength="1000" required></div>` : standardFields}<div class="form-field"><label for="message">${messageLabel}</label><textarea class="form-control" id="message" name="summary" minlength="20" maxlength="3000" required></textarea><small>${messageHelp}</small></div><div class="form-field form-consent"><label><input name="consent" type="checkbox" value="yes" required><span><a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>を確認し、入力情報の取り扱いに同意します。</span></label></div><div class="submission-trap" aria-hidden="true"><label>ウェブサイト<input name="website" tabindex="-1" autocomplete="off"></label></div>${!previewMode && publicConfig.turnstileSiteKey ? `<div class="submission-turnstile" data-turnstile-container></div><input type="hidden" name="turnstileToken">` : ""}<button class="button" type="submit" ${previewMode && submissionReady ? "" : "disabled"}>${previewMode ? "プレビュー送信を確認" : "内容を送信する"}</button><div class="form-message" data-form-message role="status" aria-live="polite"></div></form></div><div class="source-box"><h2>匿名で送信できます</h2><p>氏名とメールアドレスは任意です。送信内容がそのまま公開されることはありません。</p></div></div></section>`);
  }

  function searchPage(params) {
    const q = (params.get("q") || "").trim();
    const normalize = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, " ").trim();
    const query = normalize(q);
    const terms = query.split(" ").filter(Boolean);
    const pointTerms = (target) => data.mapPoints.filter((point) => point.target === target).flatMap((point) => [point.label, point.area, point.town, point.kind]);
    const candidates = [
      ...data.news.map((item) => ({
        type: item.important ? "ピックアップ・ニュース" : "ニュース",
        title: item.title,
        text: item.excerpt,
        url: `/news/${item.id}`,
        fields: [item.title, item.excerpt, categoryMap[item.category], item.sourceType, item.source, item.publishedAt, item.checkedAt, item.body, item.sources?.flatMap((source) => Object.values(source)), item.important ? "海老名ピックアップ おすすめ 注目" : "", pointTerms(`/news/${item.id}`)],
      })),
      ...data.followups.map((item) => ({
        type: "追跡レポート",
        title: item.title,
        text: `${item.summary}　${item.status}`,
        url: `/followups/${item.id}`,
        fields: [item.title, item.summary, item.status, item.category, item.updatedAt, item.nextCheck, item.timeline?.flatMap((entry) => Object.values(entry)), "その後どうなった 追跡レポート", pointTerms(`/followups/${item.id}`)],
      })),
      ...data.mapItems.map((item) => ({
        type: "地図情報",
        title: item.title,
        text: `${item.targetArea || item.baseArea || "海老名市"}　${item.summary}`,
        url: `/areas/${item.areaId}`,
        fields: [item.title, item.summary, item.status, categoryMap[item.category], item.targetArea, item.baseArea, item.publishedAt, item.updatedAt, item.relatedArticles?.flatMap((article) => Object.values(article)), item.history?.flatMap((entry) => Object.values(entry)), "まちマップ 地図情報"],
      })),
      ...areas.towns.map((town) => ({
        type: "町丁目",
        title: town.name,
        text: `${town.base}エリアの町丁目案内・地域情報`,
        url: `/areas/${town.id}`,
        fields: [town.name, town.base, "町丁目 まちマップ 地域案内"],
      })),
    ];
    const matches = terms.length ? candidates.map((item) => {
      const title = normalize(item.title);
      const haystack = normalize(item.fields.flat(Infinity).filter(Boolean).join(" "));
      if (!terms.every((term) => haystack.includes(term))) return null;
      const score = (title === query ? 100 : 0) + terms.reduce((total, term) => total + (title.includes(term) ? 10 : 1), 0);
      return { ...item, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja")) : [];
    return layout(`${pageHero("SEARCH", "検索結果", q ? `「${q}」の検索結果` : "キーワードを入力してください。")}<section class="section"><div class="shell"><form class="search-form" data-search-form style="max-width:720px;margin-bottom:35px"><input class="search-input" name="q" type="search" value="${esc(q)}" placeholder="ニュース、追跡、町丁目、地図情報を検索" required><button class="button">検索する</button></form>${q ? `<p class="list-count">${matches.length}件見つかりました</p>` : ""}<div class="followup-list">${matches.map((m) => `<a class="followup-row" href="${href(m.url)}"><span class="tag">${esc(m.type)}</span><div><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></div><span class="arrow">→</span></a>`).join("")}</div>${q && !matches.length ? `<div class="empty-state"><h2>一致する情報がありません</h2><p>言葉を短くするか、複数の言葉を空白で区切ってお試しください。</p></div>` : ""}</div></section>`);
  }

  function notFoundPage() { return layout(`${pageHero("404", "ページが見つかりません", "URLが変わったか、ページが削除された可能性があります。")}<section class="section"><div class="shell"><a class="button" href="/">ホームへ戻る</a></div></section>`); }

  function parseRoute() {
    const parsed = router.parse(location);
    return { ...router.match(parsed.pathname, issuesEnabled), params: parsed.params };
  }

  function navigate(path, { replace = false } = {}) {
    const target = href(path);
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (target === current) return;
    window.history[replace ? "replaceState" : "pushState"]({ ...(window.history.state || {}) }, "", target);
    render();
  }

  function render() {
    const route = parseRoute();
    const { params } = route;
    if (route.name === "area-detail") {
      try { window.history?.replaceState({ ...(window.history.state || {}), ebinaMapRestore: false }, "", window.location.href); } catch (_) { /* history state is optional in file preview */ }
    }
    let html;
    if (route.name === "home") html = homePage();
    else if (route.name === "pickup") html = pickupPage();
    else if (route.name === "news-detail") html = newsDetailPage(route.id);
    else if (route.name === "news-list") html = newsListPage(params);
    else if (route.name === "map") html = mapPage();
    else if (route.name === "area-detail") html = areaDetailPage(route.id);
    else if (route.name === "followup-detail") html = followupDetailPage(route.id);
    else if (route.name === "followups-list") html = followupsPage();
    else if (route.name === "issue-detail") html = issueDetailPage(route.id);
    else if (route.name === "issues-list") html = issuesPage();
    else if (["tips", "feedback", "corrections"].includes(route.name)) html = formPage(route.name);
    else if (route.name === "search") html = searchPage(params);
    else if (infoPages[route.name]) html = infoPage(route.name);
    else html = notFoundPage();
    window.ebinaCancelAreaClick?.();
    window.ebinaCancelAreaClick = null;
    window.ebinaDestroySvgMap?.();
    window.ebinaDestroySvgMap = null;
    if (window.ebinaInteractiveMap) {
      window.ebinaInteractiveMap.remove();
      window.ebinaInteractiveMap = null;
    }
    window.ebinaMapFilter = null;
    window.ebinaOpenAreaPage = null;
    app.innerHTML = html;
    bindInteractions();
    window.scrollTo(0, 0);
    document.title = `${document.querySelector("h1")?.textContent || data.site.name}｜${data.site.name}`;
  }

  function initSvgAreaMap() {
    const svg = document.querySelector("[data-svg-town-map]");
    const detail = document.querySelector("[data-map-detail]");
    const levelLabel = document.querySelector("[data-map-level-label]");
    const levelHelp = document.querySelector("[data-map-level-help]");
    if (!svg || !detail || !levelLabel || !levelHelp) return;
    const townElements = [...svg.querySelectorAll("[data-svg-town]")];
    const townById = new Map(areas.towns.map((town) => [String(town.id), town]));
    const nearestTown = (point) => {
      const projected = projectAreaPoint(point);
      const sameBase = areas.towns.filter((town) => town.base === point.town);
      return (sameBase.length ? sameBase : areas.towns).reduce((best, town) => {
        const distance = Math.hypot(town.cx - projected.svgX, town.cy - projected.svgY);
        return !best || distance < best.distance ? { town, distance } : best;
      }, null)?.town;
    };
    const values = areas.viewBox.split(" ").map(Number);
    const full = { x: values[0], y: values[1], width: values[2], height: values[3] };
    const ratio = full.width / full.height;
    const saved = readMapState();
    const restore = window.ebinaRestoreMapOnRender === true && saved?.restoreOnce === true;
    const initial = restore && Array.isArray(saved?.viewBox) ? { x: +saved.viewBox[0], y: +saved.viewBox[1], width: +saved.viewBox[2], height: +saved.viewBox[3] } : full;
    const state = { box: { ...initial }, selectedAreaId: restore && saved?.selectedAreaId ? String(saved.selectedAreaId) : null, category: restore ? saved?.category || "all" : window.ebinaPendingMapCategory || "all", moved: false, frame: 0, clickTimer: null, wheelTimer: null, pointers: new Map(), dragStart: null, pinchStart: null };
    if (!restore && saved?.restoreOnce) writeMapState({ ...saved, restoreOnce: false });
    const normalize = (box) => {
      let width = Math.min(full.width, Math.max(120, Number(box.width) || full.width)); let height = width / ratio;
      if (height > full.height) { height = full.height; width = height * ratio; }
      return { x: Math.min(full.width - width, Math.max(0, Number(box.x) || 0)), y: Math.min(full.height - height, Math.max(0, Number(box.y) || 0)), width, height };
    };
    const persist = (restoreOnce = false) => writeMapState({ viewBox: [state.box.x, state.box.y, state.box.width, state.box.height], selectedAreaId: state.selectedAreaId, category: state.category, restoreOnce });
    const paint = (box) => {
      state.box = normalize(box); svg.setAttribute("viewBox", `${state.box.x} ${state.box.y} ${state.box.width} ${state.box.height}`);
      const zoom = full.width / state.box.width;
      svg.classList.toggle("is-region", zoom >= 1.35); svg.classList.toggle("is-town", zoom >= 2.35); svg.classList.toggle("is-final", zoom >= 4);
      svg.querySelectorAll(".svg-event-marker-inner").forEach((marker) => marker.setAttribute("transform", `scale(${1 / zoom})`));
      svg.querySelectorAll("[data-base-label] text").forEach((label) => { label.style.fontSize = `${Math.max(3, 13 / zoom)}px`; });
      svg.querySelectorAll("[data-chome-label] text").forEach((label) => { label.style.fontSize = `${Math.max(2.4, 10.5 / zoom)}px`; });
      if (zoom < 1.35) { levelLabel.textContent = "市全体"; levelHelp.textContent = "主要地域名・情報件数・ニュース地点"; }
      else if (zoom < 2.35) { levelLabel.textContent = `地域表示 ${zoom.toFixed(1)}×`; levelHelp.textContent = "町丁目境界・町丁目名・ニュース地点"; }
      else if (zoom < 4) { levelLabel.textContent = `町丁目表示 ${zoom.toFixed(1)}×`; levelHelp.textContent = "選択丁目・地点タイトル・記事導線"; }
      else { levelLabel.textContent = `詳しい地図へ ${zoom.toFixed(1)}×`; levelHelp.textContent = "町丁目詳細ページを開けます"; }
    };
    const animateTo = (target) => {
      cancelAnimationFrame(state.frame); const start = { ...state.box }; const end = normalize(target); const started = performance.now();
      const step = (now) => { const p = Math.min(1, (now - started) / 360); const e = 1 - Math.pow(1 - p, 3); paint({ x: start.x + (end.x - start.x) * e, y: start.y + (end.y - start.y) * e, width: start.width + (end.width - start.width) * e, height: start.height + (end.height - start.height) * e }); if (p < 1) state.frame = requestAnimationFrame(step); else persist(); };
      state.frame = requestAnimationFrame(step);
    };
    const clientPoint = (x, y, box = state.box) => { const rect = svg.getBoundingClientRect(); return { x: box.x + (x - rect.left) / rect.width * box.width, y: box.y + (y - rect.top) / rect.height * box.height }; };
    const zoomAt = (factor, x = state.box.x + state.box.width / 2, y = state.box.y + state.box.height / 2, animate = true) => { const width = state.box.width * factor; const height = width / ratio; const rx = (x - state.box.x) / state.box.width; const ry = (y - state.box.y) / state.box.height; const target = { x: x - width * rx, y: y - height * ry, width, height }; animate ? animateTo(target) : paint(target); };
    const focusBase = (base) => { const b = areas.baseBounds[base]; if (!b) return; let width = Math.max(145, b.width * 1.55); let height = Math.max(180, b.height * 1.55); if (width / height > ratio) height = width / ratio; else width = height * ratio; animateTo({ x: b.x + b.width / 2 - width / 2, y: b.y + b.height / 2 - height / 2, width, height }); };
    const openArea = (id) => { state.selectedAreaId = String(id); persist(true); try { history.replaceState({ ...(history.state || {}), ebinaMapRestore: true }, "", location.href); } catch (_) {} navigate(`/areas/${id}`); };
    window.ebinaOpenAreaPage = openArea;
    const bindDetail = () => { detail.querySelectorAll("[data-map-point-id]").forEach((button) => button.addEventListener("click", () => showPoint(data.mapPoints.find((point) => point.id === button.dataset.mapPointId)))); detail.querySelector("[data-open-area]")?.addEventListener("click", (event) => openArea(event.currentTarget.dataset.openArea)); };
    const showTown = (town) => {
      const all = cityPointsForBase(town.base); const visible = all.filter((point) => state.category === "all" || point.category === state.category);
      detail.innerHTML = `<p class="eyebrow">SELECTED AREA</p><span class="map-selected-label">選択中の町丁目</span><h2>${esc(town.name)}</h2><p class="map-detail-area-name">${esc(town.base)}エリア　/　ID ${esc(town.id)}</p><div class="map-area-stats"><div><strong>${Number(town.population || 0).toLocaleString("ja-JP")}</strong><small>人口（2020年）</small></div><div><strong>${Number(town.households || 0).toLocaleString("ja-JP")}</strong><small>世帯数（2020年）</small></div><div><strong>${visible.length}</strong><small>周辺のニュース地点</small></div></div>${visible.length ? `<div class="map-area-items"><h3>${esc(town.base)}エリアの情報</h3>${visible.map((point) => `<button type="button" data-map-point-id="${esc(point.id)}"><span style="--item-color:${mapPointColor(point)}"></span><small>${esc(point.kind)}</small><strong>${esc(point.label)}</strong></button>`).join("")}</div>` : `<p class="map-detail-empty">現在の条件で掲載されているニュース地点はありません。</p>`}<button class="button button--orange map-area-detail-button" type="button" data-open-area="${esc(town.id)}">この丁目の詳しい地図を見る</button>`; bindDetail();
    };
    const showPoint = (point) => {
      const content = mapPointContent(point); const town = nearestTown(point);
      detail.innerHTML = `<p class="eyebrow">NEWS LOCATION</p><span class="map-detail-demo">デモデータ</span><h2>${esc(content.title)}</h2><div class="map-detail-meta"><span style="--item-color:${mapPointColor(point)}">${esc(point.kind)}</span><small>${esc(categoryMap[point.category])}　/　${esc(point.area)}</small></div><p>${esc(content.summary)}</p><dl class="map-detail-dates"><div><dt>地域</dt><dd>${esc(point.town)}・${esc(point.area)}</dd></div><div><dt>情報</dt><dd>${esc(content.meta)}</dd></div></dl><a class="button map-area-detail-button" href="${href(point.target)}">${esc(content.linkLabel)}</a>${town ? `<button class="button button--orange map-area-detail-button" type="button" data-open-area="${esc(town.id)}">この付近の町丁目詳細を見る</button>` : ""}`; bindDetail();
    };
    const selectTown = (id, focus = true) => { const town = townById.get(String(id)); if (!town) return; state.selectedAreaId = String(id); townElements.forEach((el) => el.classList.toggle("is-selected", el.dataset.areaId === state.selectedAreaId)); svg.querySelectorAll("[data-chome-label]").forEach((el) => el.classList.toggle("is-selected", el.dataset.chomeLabel === state.selectedAreaId)); const select = document.querySelector("[data-keyboard-area-select]"); if (select) select.value = state.selectedAreaId; showTown(town); persist(); if (focus && full.width / state.box.width < 2.15) focusBase(town.base); };
    const filter = (category) => { state.category = category; const visible = data.mapPoints.filter((point) => category === "all" || point.category === category); const ids = new Set(visible.map((point) => point.id)); const bases = new Set(visible.map((point) => point.town)); svg.querySelectorAll("[data-svg-news-point]").forEach((marker) => marker.classList.toggle("is-filtered", !ids.has(marker.dataset.svgNewsPoint))); townElements.forEach((town) => town.classList.toggle("has-update", bases.has(town.dataset.areaBase))); const counts = {}; visible.forEach((point) => { counts[point.town] = (counts[point.town] || 0) + 1; }); svg.querySelectorAll("[data-base-count]").forEach((label) => { label.textContent = `情報 ${counts[label.dataset.baseCount] || 0}件`; }); if (state.selectedAreaId) showTown(townById.get(state.selectedAreaId)); persist(); };
    window.ebinaMapFilter = filter;
    document.querySelector("[data-keyboard-area-select]")?.addEventListener("change", (event) => { if (event.target.value) selectTown(event.target.value); });
    const cancelClick = () => { clearTimeout(state.clickTimer); state.clickTimer = null; }; window.ebinaCancelAreaClick = cancelClick;
    townElements.forEach((town) => {
      town.addEventListener("click", (event) => {
        if (state.moved) return cancelClick();
        const touchActivation = ["touch", "pen"].includes(event.pointerType) || window.matchMedia?.("(pointer: coarse)").matches;
        if (touchActivation) {
          event.preventDefault();
          cancelClick();
          if (state.selectedAreaId === String(town.dataset.areaId)) openArea(town.dataset.areaId);
          else selectTown(town.dataset.areaId);
          return;
        }
        if (event.detail > 1) return cancelClick();
        cancelClick();
        state.clickTimer = setTimeout(() => selectTown(town.dataset.areaId), 210);
      });
      town.addEventListener("dblclick", (event) => { event.preventDefault(); event.stopPropagation(); cancelClick(); openArea(town.dataset.areaId); });
      town.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); openArea(town.dataset.areaId); } else if (event.key === " ") { event.preventDefault(); selectTown(town.dataset.areaId); } });
    });
    svg.querySelectorAll("[data-svg-news-point]").forEach((marker) => { const activate = () => { const point = data.mapPoints.find((entry) => entry.id === marker.dataset.svgNewsPoint); if (!point) return; const town = nearestTown(point); if (town) selectTown(town.id, false); showPoint(point); if (full.width / state.box.width < 2.5) focusBase(point.town); }; marker.addEventListener("click", (event) => { event.stopPropagation(); activate(); }); marker.addEventListener("dblclick", (event) => { event.preventDefault(); event.stopPropagation(); }); marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }); });
    document.querySelector("[data-svg-zoom-in]")?.addEventListener("click", () => zoomAt(.72)); document.querySelector("[data-svg-zoom-out]")?.addEventListener("click", () => zoomAt(1.38)); document.querySelector("[data-svg-reset]")?.addEventListener("click", () => animateTo(full));
    svg.addEventListener("wheel", (event) => { event.preventDefault(); const point = clientPoint(event.clientX, event.clientY); zoomAt(event.deltaY < 0 ? .86 : 1.17, point.x, point.y, false); clearTimeout(state.wheelTimer); state.wheelTimer = setTimeout(() => persist(), 100); }, { passive: false });
    svg.addEventListener("dblclick", (event) => { if (event.target.closest?.("[data-svg-town], [data-svg-news-point]")) return; event.preventDefault(); const point = clientPoint(event.clientX, event.clientY); zoomAt(.68, point.x, point.y); });
    svg.addEventListener("pointerdown", (event) => { state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); svg.setPointerCapture?.(event.pointerId); if (state.pointers.size === 1) state.dragStart = { pointer: { x: event.clientX, y: event.clientY }, box: { ...state.box } }; if (state.pointers.size === 2) { const [a, b] = [...state.pointers.values()]; state.pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), box: { ...state.box }, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; } });
    svg.addEventListener("pointermove", (event) => { if (!state.pointers.has(event.pointerId)) return; state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const rect = svg.getBoundingClientRect(); if (state.pointers.size >= 2 && state.pinchStart) { const [a, b] = [...state.pointers.values()]; const distance = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)); const start = state.pinchStart.box; const focus = clientPoint(state.pinchStart.center.x, state.pinchStart.center.y, start); const width = start.width * state.pinchStart.distance / distance; const height = width / ratio; const rx = (focus.x - start.x) / start.width; const ry = (focus.y - start.y) / start.height; state.moved = true; paint({ x: focus.x - width * rx, y: focus.y - height * ry, width, height }); } else if (state.dragStart && state.pointers.size === 1 && full.width / state.box.width > 1.02) { const dx = event.clientX - state.dragStart.pointer.x; const dy = event.clientY - state.dragStart.pointer.y; if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true; paint({ x: state.dragStart.box.x - dx / rect.width * state.dragStart.box.width, y: state.dragStart.box.y - dy / rect.height * state.dragStart.box.height, width: state.dragStart.box.width, height: state.dragStart.box.height }); } });
    const stop = (event) => { state.pointers.delete(event.pointerId); if (state.pointers.size < 2) state.pinchStart = null; if (!state.pointers.size) { state.dragStart = null; persist(); setTimeout(() => { state.moved = false; }, 0); } }; svg.addEventListener("pointerup", stop); svg.addEventListener("pointercancel", stop);
    window.ebinaDestroySvgMap = () => { cancelAnimationFrame(state.frame); clearTimeout(state.clickTimer); clearTimeout(state.wheelTimer); };
    paint(initial); filter(state.category); if (state.selectedAreaId) selectTown(state.selectedAreaId, false); if (restore) persist(false); window.ebinaRestoreRequested = false; window.ebinaRestoreMapOnRender = false; try { history.replaceState({ ...(history.state || {}), ebinaMapRestore: false }, "", location.href); } catch (_) {}
  }

  let mapGeoLoader;
  const ensureMapGeo = () => {
    if (mapGeo) return Promise.resolve(mapGeo);
    if (mapGeoLoader) return mapGeoLoader;
    mapGeoLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.id = "map-geo-script"; script.src = "/map-geo.js";
      script.onload = () => { mapGeo = window.EBINA_MAP_GEO || null; mapGeo ? resolve(mapGeo) : reject(new Error("町丁目の詳細境界データを確認できませんでした")); };
      script.onerror = () => reject(new Error("町丁目の詳細境界データを読み込めませんでした")); document.head.appendChild(script);
    });
    return mapGeoLoader;
  };

  let mapLibreLoader;
  const ensureMapLibre = () => {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibreLoader) return mapLibreLoader;
    mapLibreLoader = new Promise((resolve, reject) => {
      if (!document.querySelector("#maplibre-css")) {
        const link = document.createElement("link");
        link.id = "maplibre-css";
        link.rel = "stylesheet";
        link.href = "/vendor/maplibre/maplibre-gl.css";
        const mainStyles = document.querySelector('link[href^="/styles.css"]');
        document.head.insertBefore(link, mainStyles || null);
      }
      const script = document.createElement("script");
      script.src = "/vendor/maplibre/maplibre-gl.js";
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error("地図機能を読み込めませんでした"));
      document.head.appendChild(script);
    });
    return mapLibreLoader;
  };

  const mapItemColor = (status) => {
    if (status === "完成") return "#7ca447";
    if (status === "地域課題") return "#a77a2b";
    if (status === "続報待ち") return "#1c3966";
    return "#c94731";
  };

  const mapItemsGeoJSON = (category = "all") => ({
    type: "FeatureCollection",
    features: data.mapItems.filter((item) => category === "all" || item.category === category).map((item) => ({
      type: "Feature",
      id: item.id,
      properties: { id: item.id, areaId: item.areaId, title: item.title, category: item.category, status: item.status, color: mapItemColor(item.status), targetArea: item.targetArea, baseArea: item.baseArea },
      geometry: { type: "Point", coordinates: [item.lng, item.lat] },
    })),
  });

  const mapPointsGeoJSON = (category = "all") => ({
    type: "FeatureCollection",
    features: data.mapPoints.filter((point) => category === "all" || point.category === category).map((point) => ({
      type: "Feature",
      id: point.id,
      properties: { id: point.id, title: point.label, category: point.category, kind: point.kind, color: mapPointColor(point), target: point.target },
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    })),
  });

  const cityLandmarksGeoJSON = () => ({
    type: "FeatureCollection",
    features: CITY_LANDMARKS.map((landmark) => ({
      type: "Feature",
      id: landmark.id,
      properties: { id: landmark.id, name: landmark.name, category: landmark.category, color: landmark.color },
      geometry: { type: "Point", coordinates: [landmark.lng, landmark.lat] },
    })),
  });

  const mapAreasWithCounts = () => ({
    type: "FeatureCollection",
    features: mapGeo.areas.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        demoCount: areaItems(feature.id).length,
      },
    })),
  });

  function initAreaMap() {
    const container = document.querySelector("#ebina-interactive-map");
    const loading = document.querySelector("[data-interactive-map-loading]");
    const detail = document.querySelector("[data-map-detail]");
    const levelLabel = document.querySelector("[data-map-level-label]");
    const levelHelp = document.querySelector("[data-map-level-help]");
    const landmarkStrip = document.querySelector("[data-city-landmark-strip]");
    const overview = document.querySelector("[data-city-overview]");
    const overviewWindow = document.querySelector("[data-city-overview-window]");
    if (!container || !loading || !detail || !levelLabel || !levelHelp) return;
    const savedState = readMapState();
    const shouldRestore = window.ebinaRestoreMapOnRender === true && savedState?.restoreOnce === true;
    const restoredState = shouldRestore ? savedState : null;
    if (!shouldRestore && savedState?.restoreOnce) writeMapState({ ...savedState, restoreOnce: false });
    let map;
    let initializationTimer = null;
    let initializationFailed = false;
    let selectedAreaId = restoredState?.selectedAreaId ? String(restoredState.selectedAreaId) : null;
    let selectedLandmarkId = null;
    let currentCategory = restoredState?.category || window.ebinaPendingMapCategory || "all";

    const showMapError = (error, logError = true) => {
      if (logError) console.error("[海老名まちマップ]", error);
      if (initializationFailed) return;
      initializationFailed = true;
      if (initializationTimer !== null) clearTimeout(initializationTimer);
      const message = error?.message || "地図の初期化に失敗しました";
      loading.hidden = false;
      loading.innerHTML = `<strong>地図を表示できませんでした</strong><small>${esc(message)}</small><button class="button" type="button" data-map-retry>もう一度読み込む</button>`;
      loading.querySelector("[data-map-retry]")?.addEventListener("click", () => location.reload());
    };

    const currentMapState = (restoreOnce = false) => {
      if (!map) return { ...(restoredState || {}), selectedAreaId, category: currentCategory, restoreOnce };
      const center = map.getCenter();
      return { center: [center.lng, center.lat], zoom: map.getZoom(), selectedAreaId, category: currentCategory, restoreOnce };
    };
    const persistMapState = () => {
      if (!map) return;
      writeMapState(currentMapState(false));
    };
    const openAreaPage = (id) => {
      selectedAreaId = String(id);
      writeMapState(currentMapState(true));
      try { window.history?.replaceState({ ...(window.history.state || {}), ebinaMapRestore: true }, "", window.location.href); } catch (_) { /* history state is optional in file preview */ }
      navigate(`/areas/${id}`);
    };
    window.ebinaOpenAreaPage = openAreaPage;

    const showAreaDetail = (feature) => {
      if (!feature) return;
      const { name, base, population, households } = feature.properties;
      const id = String(feature.id);
      const items = areaItems(id);
      detail.innerHTML = `<p class="eyebrow">SELECTED AREA</p><span class="map-selected-label">選択中の町丁目</span><h2>${esc(name)}</h2><p class="map-detail-area-name">${esc(base)}エリア　/　ID ${esc(id)}</p><div class="map-area-stats"><div><strong>${Number(population).toLocaleString("ja-JP")}</strong><small>人口（2020年）</small></div><div><strong>${Number(households).toLocaleString("ja-JP")}</strong><small>世帯数（2020年）</small></div><div><strong>${items.length}</strong><small>デモ情報</small></div></div>${items.length ? `<div class="map-area-items"><h3>この地域の情報</h3>${items.map((item) => `<button type="button" data-map-item-id="${item.id}"><span style="--item-color:${mapItemColor(item.status)}"></span><small>${esc(item.status)}</small><strong>${esc(item.title)}</strong></button>`).join("")}</div>` : `<p class="map-detail-empty">現在掲載されている情報はありません。</p>`}<button class="button button--orange map-area-detail-button" type="button" data-open-area="${esc(id)}" aria-label="${esc(name)}の詳細ページを開く">この地域を詳しく見る</button>${!items.length ? `<a class="text-link map-area-tip-link" href="/tips">この地域の情報を提供する →</a>` : ""}`;
      detail.querySelectorAll("[data-map-item-id]").forEach((button) => button.addEventListener("click", () => showItemDetail(data.mapItems.find((item) => item.id === button.dataset.mapItemId))));
      detail.querySelector("[data-open-area]")?.addEventListener("click", () => openAreaPage(id));
    };

    const showBaseDetail = (base) => {
      const features = mapGeo.areas.features.filter((feature) => feature.properties.base === base);
      const population = features.reduce((sum, feature) => sum + Number(feature.properties.population || 0), 0);
      const households = features.reduce((sum, feature) => sum + Number(feature.properties.households || 0), 0);
      const itemCount = features.reduce((sum, feature) => sum + areaItems(feature.id).length, 0);
      detail.innerHTML = `<p class="eyebrow">AREA GROUP</p><h2>${esc(base)}エリア</h2><p class="map-detail-area-name">町丁目を選ぶと詳細ページへ進めます。</p><div class="map-area-stats"><div><strong>${population.toLocaleString("ja-JP")}</strong><small>人口（2020年）</small></div><div><strong>${households.toLocaleString("ja-JP")}</strong><small>世帯数（2020年）</small></div><div><strong>${itemCount}</strong><small>デモ情報</small></div></div><p class="map-detail-empty">地図をもう一段階拡大して、丁目名を選択してください。</p>`;
    };

    const showItemDetail = (item) => {
      if (!item) return;
      detail.innerHTML = `<p class="eyebrow">LOCATION DETAIL</p><span class="map-detail-demo">デモデータ</span><h2>${esc(item.title)}</h2><div class="map-detail-meta"><span style="--item-color:${mapItemColor(item.status)}">${esc(item.status)}</span><small>${esc(categoryMap[item.category])}　/　${esc(item.targetArea)}</small></div>${item.image ? `<figure class="map-detail-image"><img src="${esc(item.image)}" alt="${esc(item.imageAlt)}" loading="lazy"><figcaption>デモ用抽象画像・実景ではありません</figcaption></figure>` : ""}<p>${esc(item.summary)}</p><dl class="map-detail-dates"><div><dt>公開日</dt><dd>${esc(item.publishedAt)}</dd></div><div><dt>更新日</dt><dd>${esc(item.updatedAt)}</dd></div></dl><section class="map-detail-related"><h3>関連記事</h3>${item.relatedArticles.map((article) => `<a href="${href(article.href)}">${esc(article.label)} →</a>`).join("")}</section><section class="map-detail-history"><h3>更新履歴</h3>${item.history.map((entry) => `<div><time>${esc(entry.date)}</time><strong>${esc(entry.status)}</strong><p>${esc(entry.note)}</p></div>`).join("")}</section><button class="button map-area-detail-button" type="button" data-open-area="${esc(item.areaId)}" aria-label="${esc(item.targetArea)}の詳細ページを開く">${esc(item.targetArea)}を詳しく見る</button>`;
      detail.querySelector("[data-open-area]")?.addEventListener("click", () => openAreaPage(item.areaId));
    };

    const showNewsPointDetail = (point) => {
      if (!point) return;
      const content = mapPointContent(point);
      detail.innerHTML = `<p class="eyebrow">NEWS LOCATION</p><span class="map-detail-demo">デモデータ</span><h2>${esc(content.title)}</h2><div class="map-detail-meta"><span style="--item-color:${mapPointColor(point)}">${esc(point.kind)}</span><small>${esc(categoryMap[point.category])}　/　${esc(point.area)}</small></div><p>${esc(content.summary)}</p><dl class="map-detail-dates"><div><dt>地域</dt><dd>${esc(point.town)}・${esc(point.area)}</dd></div><div><dt>情報</dt><dd>${esc(content.meta)}</dd></div></dl><a class="button button--orange map-area-detail-button" href="${href(point.target)}">${esc(content.linkLabel)}</a>`;
    };

    Promise.all([ensureMapGeo(), ensureMapLibre()]).then(([, maplibregl]) => {
      if (!document.body.contains(container)) return;
      currentCategory = window.ebinaPendingMapCategory || currentCategory;
      const areaData = mapAreasWithCounts();
      const style = {
        version: 8,
        sources: {
          "gsi-pale": { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 5, maxzoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（国土地理院）</a>' },
          areas: { type: "geojson", data: areaData },
          "city-landmarks": { type: "geojson", data: cityLandmarksGeoJSON() },
          "news-points": { type: "geojson", data: mapPointsGeoJSON(currentCategory) },
          items: { type: "geojson", data: mapItemsGeoJSON(currentCategory), cluster: true, clusterRadius: 55, clusterMaxZoom: 14 },
        },
        layers: [
          { id: "paper", type: "background", paint: { "background-color": "#f7f3e9" } },
          { id: "detail-background", type: "raster", source: "gsi-pale", minzoom: 13.6, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 13.6, 0, 14.4, 0.78], "raster-saturation": -0.5, "raster-contrast": -0.08, "raster-brightness-max": 0.96 } },
          { id: "area-fill", type: "fill", source: "areas", paint: { "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#efb37f", ["boolean", ["feature-state", "hover"], false], "#b7d6d1", [">", ["get", "demoCount"], 0], "#d5e5e1", "#ebe9e1"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["boolean", ["feature-state", "selected"], false], 0.5, 0.96], 13.6, ["case", ["boolean", ["feature-state", "selected"], false], 0.25, 0.82], 14.5, ["case", ["boolean", ["feature-state", "selected"], false], 0.08, 0.14]] } },
          { id: "area-line", type: "line", source: "areas", paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["boolean", ["feature-state", "selected"], false], "#c94731", "#ffffff"], 13.5, ["case", ["boolean", ["feature-state", "selected"], false], "#c94731", "#d7dad5"], 15, ["case", ["boolean", ["feature-state", "selected"], false], "#c94731", "#1c3966"]], "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.2], 14, ["case", ["boolean", ["feature-state", "selected"], false], 3.5, 1.5], 16, ["case", ["boolean", ["feature-state", "selected"], false], 4, 2]], "line-opacity": 0.95 } },
          { id: "item-clusters", type: "circle", source: "items", minzoom: 12.2, filter: ["has", "point_count"], paint: { "circle-color": "#1c3966", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 23], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
          { id: "item-halo", type: "circle", source: "items", minzoom: 12.2, filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["get", "color"], "circle-radius": 15, "circle-opacity": 0.18 } },
          { id: "item-points", type: "circle", source: "items", minzoom: 12.2, filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.2, 6, 15, 9], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
          { id: "news-point-halo", type: "circle", source: "news-points", paint: { "circle-color": ["get", "color"], "circle-radius": 14, "circle-opacity": 0.2 } },
          { id: "news-points", type: "circle", source: "news-points", paint: { "circle-color": ["get", "color"], "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
        ],
      };
      try {
        map = new maplibregl.Map({ container, style, center: restoredState?.center || [139.4, 35.445], zoom: Number.isFinite(restoredState?.zoom) ? restoredState.zoom : 11.1, minZoom: 10.3, maxZoom: 18, cooperativeGestures: false, attributionControl: true, dragRotate: false, pitchWithRotate: false });
      } catch (error) {
        showMapError(error);
        return;
      }
      window.ebinaInteractiveMap = map;
      initializationTimer = setTimeout(() => {
        if (!map.loaded()) showMapError(new Error("地図の初期化がタイムアウトしました"));
      }, 12000);
      map.on("error", (event) => {
        const error = event.error || new Error("地図の読み込み中にエラーが発生しました");
        console.error("[海老名まちマップ]", error);
        const isIndividualTileError = Boolean(event.tile) || event.sourceId === "gsi-pale" || /cyberjapandata|\/xyz\/pale\//i.test(error.message || "");
        if (!isIndividualTileError && !map.loaded()) showMapError(error, false);
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-left");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

      let activeUpdatePopup = null;
      const showUpdatePopup = ({ lng, lat, kind, title, meta, target, linkLabel }) => {
        activeUpdatePopup?.remove();
        activeUpdatePopup = new maplibregl.Popup({ maxWidth: "340px", offset: 18 })
          .setLngLat([lng, lat])
          .setHTML(`<div class="area-map-popup"><small>${esc(kind)}</small><strong>${esc(title)}</strong><span>${esc(meta)}</span><a href="${href(target)}">${esc(linkLabel)} →</a></div>`)
          .addTo(map);
      };

      const htmlLabelMarkers = new Map();
      const chomeLabelEntries = (() => {
        const seen = new Set();
        return mapGeo.chomeLabels.features.flatMap((label) => {
          const feature = mapGeo.areas.features.find((area) => area.properties.name === label.properties.name);
          if (!feature || seen.has(String(feature.id))) return [];
          seen.add(String(feature.id));
          return [{ id: String(feature.id), name: feature.properties.name, coordinates: label.geometry.coordinates }];
        });
      })();
      const baseLabelEntries = mapGeo.baseLabels.features.map((label) => ({ id: `base:${label.properties.name}`, name: label.properties.name, coordinates: label.geometry.coordinates }));
      const refreshHtmlLabels = () => {
        const zoom = map.getZoom();
        const bounds = map.getBounds();
        let desired = [];
        if (zoom < 12.35) desired = baseLabelEntries;
        else if (zoom < 14.7) desired = chomeLabelEntries.filter((label) => bounds.contains(label.coordinates));
        else desired = chomeLabelEntries.filter((label) => label.id === selectedAreaId && bounds.contains(label.coordinates));
        const desiredIds = new Set(desired.map((label) => label.id));
        htmlLabelMarkers.forEach((entry, id) => {
          if (!desiredIds.has(id)) { entry.marker.remove(); htmlLabelMarkers.delete(id); }
        });
        desired.forEach((label) => {
          let entry = htmlLabelMarkers.get(label.id);
          if (!entry) {
            const element = document.createElement("span");
            element.className = `map-html-label ${label.id.startsWith("base:") ? "map-html-label--base" : "map-html-label--chome"}`;
            element.textContent = label.name;
            element.setAttribute("aria-hidden", "true");
            const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(label.coordinates).addTo(map);
            entry = { marker, element };
            htmlLabelMarkers.set(label.id, entry);
          }
          entry.element.classList.toggle("is-selected", label.id === selectedAreaId);
        });
      };

      const setActiveLandmark = (id) => {
        if (selectedLandmarkId && map.getSource("city-landmarks")) map.setFeatureState({ source: "city-landmarks", id: selectedLandmarkId }, { selected: false });
        selectedLandmarkId = id && id !== "all" ? String(id) : null;
        if (selectedLandmarkId && map.getSource("city-landmarks")) map.setFeatureState({ source: "city-landmarks", id: selectedLandmarkId }, { selected: true });
        document.querySelectorAll("[data-city-landmark]").forEach((button) => { const active = button.dataset.cityLandmark === (id || ""); button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
        document.querySelectorAll("[data-city-overview-landmark]").forEach((dot) => dot.classList.toggle("is-active", dot.dataset.cityOverviewLandmark === selectedLandmarkId));
        document.querySelectorAll("[data-city-landmark-marker]").forEach((marker) => { const active = marker.dataset.cityLandmarkMarker === selectedLandmarkId; marker.classList.toggle("is-selected", active); marker.style.zIndex = active ? "8" : ""; });
      };
      const fitCity = (duration = 650) => {
        if (selectedAreaId && map.getSource("areas")) map.setFeatureState({ source: "areas", id: selectedAreaId }, { selected: false });
        selectedAreaId = null;
        setActiveLandmark("all");
        map.fitBounds(mapGeo.bounds, { padding: { top: 55, right: 55, bottom: 55, left: 55 }, duration });
        const options = areas.towns.map((town) => `<option value="${esc(String(town.id))}">${esc(town.name)}（${esc(town.base)}エリア）</option>`).join("");
        detail.innerHTML = `<p class="eyebrow">CITY OVERVIEW</p><h2>海老名市全体</h2><p>上の目印を選ぶと、市内の主な駅・公園・公共施設へ移動できます。右下のミニ全体図を押して移動することもできます。</p><div class="map-detail-summary"><strong>主な目印 ${CITY_LANDMARKS.length}か所</strong><small>市内の位置関係をつかむための案内です</small></div><div class="map-keyboard-areas"><label for="map-area-select">町丁目を選ぶ</label><select id="map-area-select" data-keyboard-area-select><option value="">町丁目を選択してください</option>${options}</select><button class="button" type="button" data-keyboard-area-open>選択した地域を詳しく見る</button></div>`;
        const select = detail.querySelector("[data-keyboard-area-select]");
        const openSelectedArea = () => { if (select?.value) openAreaPage(select.value); else select?.focus(); };
        detail.querySelector("[data-keyboard-area-open]")?.addEventListener("click", openSelectedArea);
        select?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); openSelectedArea(); } });
        refreshHtmlLabels();
      };
      const jumpToLandmark = (landmark) => {
        if (!landmark) return;
        if (selectedAreaId && map.getSource("areas")) map.setFeatureState({ source: "areas", id: selectedAreaId }, { selected: false });
        selectedAreaId = null;
        setActiveLandmark(landmark.id);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        map.easeTo({ center: [landmark.lng, landmark.lat], zoom: landmark.zoom, duration: reducedMotion ? 0 : 800 });
        detail.innerHTML = `<p class="eyebrow">CITY LANDMARK</p><span class="map-selected-label">${esc(landmark.category)}の目印</span><h2>${esc(landmark.name)}</h2><p>${esc(landmark.description)}</p><div class="map-detail-summary"><strong>地図をこの周辺へ移動しました</strong><small>町丁目を押すと地域の詳しい情報を確認できます</small></div>`;
        document.querySelector(`[data-city-landmark="${landmark.id}"]`)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
        refreshHtmlLabels();
      };
      const overviewValues = areas.viewBox.split(" ").map(Number);
      const overviewBox = { x: overviewValues[0], y: overviewValues[1], width: overviewValues[2], height: overviewValues[3] };
      const updateOverviewWindow = () => {
        if (!overviewWindow) return;
        const bounds = map.getBounds();
        const northWest = projectAreaPoint({ lng: bounds.getWest(), lat: bounds.getNorth() });
        const southEast = projectAreaPoint({ lng: bounds.getEast(), lat: bounds.getSouth() });
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const left = clamp(Math.min(northWest.svgX, southEast.svgX), overviewBox.x, overviewBox.x + overviewBox.width);
        const right = clamp(Math.max(northWest.svgX, southEast.svgX), overviewBox.x, overviewBox.x + overviewBox.width);
        const top = clamp(Math.min(northWest.svgY, southEast.svgY), overviewBox.y, overviewBox.y + overviewBox.height);
        const bottom = clamp(Math.max(northWest.svgY, southEast.svgY), overviewBox.y, overviewBox.y + overviewBox.height);
        const width = Math.min(overviewBox.width, Math.max(28, right - left));
        const height = Math.min(overviewBox.height, Math.max(28, bottom - top));
        overviewWindow.setAttribute("x", String(Math.min(overviewBox.x + overviewBox.width - width, left)));
        overviewWindow.setAttribute("y", String(Math.min(overviewBox.y + overviewBox.height - height, top)));
        overviewWindow.setAttribute("width", String(width));
        overviewWindow.setAttribute("height", String(height));
      };
      const moveFromOverview = (event, instant = false) => {
        if (!overview) return;
        const rect = overview.getBoundingClientRect();
        const svgX = overviewBox.x + (event.clientX - rect.left) / rect.width * overviewBox.width;
        const svgY = overviewBox.y + (event.clientY - rect.top) / rect.height * overviewBox.height;
        const point = unprojectAreaPoint(svgX, svgY);
        setActiveLandmark("");
        instant ? map.jumpTo({ center: [point.lng, point.lat] }) : map.easeTo({ center: [point.lng, point.lat], duration: 350 });
      };
      let overviewDragging = false;
      overview?.addEventListener("pointerdown", (event) => { event.preventDefault(); overviewDragging = true; overview.setPointerCapture?.(event.pointerId); moveFromOverview(event); });
      overview?.addEventListener("pointermove", (event) => { if (overviewDragging) moveFromOverview(event, true); });
      const stopOverviewDrag = (event) => { overviewDragging = false; if (overview?.hasPointerCapture?.(event.pointerId)) overview.releasePointerCapture(event.pointerId); };
      overview?.addEventListener("pointerup", stopOverviewDrag);
      overview?.addEventListener("pointercancel", stopOverviewDrag);
      overview?.addEventListener("keydown", (event) => {
        const pan = { ArrowLeft: [-90, 0], ArrowRight: [90, 0], ArrowUp: [0, -90], ArrowDown: [0, 90] }[event.key];
        if (pan) { event.preventDefault(); setActiveLandmark(""); map.panBy(pan, { duration: 250 }); }
        else if (event.key === "Home") { event.preventDefault(); fitCity(); }
      });
      document.querySelector("[data-city-overview-fit]")?.addEventListener("click", () => fitCity());
      landmarkStrip?.querySelectorAll("[data-city-landmark]").forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.cityLandmark === "all") fitCity();
        else jumpToLandmark(CITY_LANDMARKS.find((landmark) => landmark.id === button.dataset.cityLandmark));
      }));
      document.querySelectorAll("[data-city-landmark-scroll]").forEach((button) => button.addEventListener("click", () => {
        const direction = Number(button.dataset.cityLandmarkScroll || 1);
        landmarkStrip?.scrollBy({ left: direction * Math.max(240, landmarkStrip.clientWidth * 0.72), behavior: "smooth" });
      }));
      landmarkStrip?.addEventListener("wheel", (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        landmarkStrip.scrollLeft += event.deltaY;
      }, { passive: false });

      const selectAreaFeature = (feature, center, shouldMove = true) => {
        if (!feature) return;
        setActiveLandmark("");
        if (selectedAreaId && selectedAreaId !== String(feature.id)) map.setFeatureState({ source: "areas", id: selectedAreaId }, { selected: false });
        selectedAreaId = String(feature.id);
        map.setFeatureState({ source: "areas", id: selectedAreaId }, { selected: true });
        refreshHtmlLabels();
        showAreaDetail(feature);
        persistMapState();
        if (shouldMove) map.easeTo({ center, zoom: Math.max(map.getZoom(), 13.25), duration: 850 });
      };
      const updateSemanticLevel = () => {
        const zoom = map.getZoom();
        container.classList.toggle("is-landmark-detail", zoom >= 14.5);
        if (zoom < 12.35) { levelLabel.textContent = "市全体"; levelHelp.textContent = "町名・地域区分・情報件数"; }
        else if (zoom < 13.6) { levelLabel.textContent = "町丁目"; levelHelp.textContent = "人口・世帯・地域情報"; }
        else if (zoom < 15.2) { levelLabel.textContent = "詳細地図"; levelHelp.textContent = "道路・建物・開発地点"; }
        else { levelLabel.textContent = "地点詳細"; levelHelp.textContent = "計画・状況・関連記事・履歴"; }
      };
      map.on("zoomend", () => { updateSemanticLevel(); refreshHtmlLabels(); updateOverviewWindow(); });
      map.on("load", () => {
        if (initializationTimer !== null) clearTimeout(initializationTimer);
        updateSemanticLevel();
        if (!restoredState?.center || !Number.isFinite(restoredState?.zoom)) fitCity(0);
        const restoredFeature = selectedAreaId ? areaFeature(selectedAreaId) : null;
        if (restoredFeature) selectAreaFeature(restoredFeature, restoredState.center, false);
        if (shouldRestore && !restoredFeature) persistMapState();
        window.ebinaRestoreRequested = false;
        window.ebinaRestoreMapOnRender = false;
        try { window.history?.replaceState({ ...(window.history.state || {}), ebinaMapRestore: false }, "", window.location.href); } catch (_) { /* history state is optional in file preview */ }
        CITY_LANDMARKS.forEach((landmark) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "city-landmark-marker";
          element.dataset.cityLandmarkMarker = landmark.id;
          element.setAttribute("aria-label", `${landmark.name}へ移動`);
          element.innerHTML = `<span class="city-landmark-marker-visual"><span class="city-landmark-marker-art">${cityLandmarkIllustration(landmark.imagePath)}</span><span class="city-landmark-marker-name">${esc(landmark.name)}</span></span>`;
          element.addEventListener("pointerdown", (event) => event.stopPropagation());
          element.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); jumpToLandmark(landmark); });
          new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -7] }).setLngLat([landmark.lng, landmark.lat]).addTo(map);
        });
        refreshHtmlLabels();
        updateOverviewWindow();
        loading.hidden = true;
      });
      map.on("move", updateOverviewWindow);
      map.on("moveend", () => { persistMapState(); refreshHtmlLabels(); updateOverviewWindow(); });
      map.on("dragstart", () => setActiveLandmark(""));
      let hoveredArea = null;
      map.on("mousemove", "area-fill", (event) => {
        if (!event.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const nextArea = String(event.features[0].id);
        if (hoveredArea === nextArea) return;
        if (hoveredArea !== null) map.setFeatureState({ source: "areas", id: hoveredArea }, { hover: false });
        hoveredArea = nextArea;
        map.setFeatureState({ source: "areas", id: hoveredArea }, { hover: true });
      });
      map.on("mouseleave", "area-fill", () => {
        map.getCanvas().style.cursor = "";
        if (hoveredArea !== null) map.setFeatureState({ source: "areas", id: hoveredArea }, { hover: false });
        hoveredArea = null;
      });
      let areaClickTimer = null;
      const cancelAreaClick = () => {
        if (areaClickTimer !== null) clearTimeout(areaClickTimer);
        areaClickTimer = null;
      };
      window.ebinaCancelAreaClick = cancelAreaClick;
      map.on("click", "area-fill", (event) => {
        if (map.queryRenderedFeatures(event.point, { layers: ["news-points", "item-points", "item-clusters"] }).length) return;
        if (event.originalEvent?.detail > 1) { cancelAreaClick(); return; }
        const rendered = event.features?.[0];
        const feature = rendered ? areaFeature(rendered.id) : null;
        if (!feature) return;
        cancelAreaClick();
        if (selectedAreaId === String(feature.id)) {
          openAreaPage(feature.id);
          return;
        }
        const center = [event.lngLat.lng, event.lngLat.lat];
        areaClickTimer = setTimeout(() => {
          areaClickTimer = null;
          selectAreaFeature(feature, center);
        }, 220);
      });
      map.on("dblclick", "area-fill", (event) => {
        if (map.queryRenderedFeatures(event.point, { layers: ["news-points", "item-points", "item-clusters"] }).length) return;
        const feature = event.features?.[0];
        if (!feature) return;
        cancelAreaClick();
        event.preventDefault();
        event.originalEvent?.preventDefault();
        openAreaPage(feature.id);
      });
      map.on("click", "news-points", (event) => {
        cancelAreaClick();
        setActiveLandmark("");
        const id = event.features?.[0]?.properties?.id;
        const point = data.mapPoints.find((entry) => entry.id === id);
        if (!point) return;
        const content = mapPointContent(point);
        showUpdatePopup({
          lng: point.lng,
          lat: point.lat,
          kind: point.kind,
          title: content.title,
          meta: content.meta,
          target: point.target,
          linkLabel: content.linkLabel,
        });
        showNewsPointDetail(point);
        map.easeTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 11.8), duration: 550 });
      });
      map.on("mouseenter", "news-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "news-points", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", "item-clusters", async (event) => {
        setActiveLandmark("");
        const feature = event.features?.[0];
        if (!feature) return;
        const source = map.getSource("items");
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 650 });
      });
      map.on("click", "item-points", (event) => {
        cancelAreaClick();
        setActiveLandmark("");
        const id = event.features?.[0]?.properties?.id;
        const item = data.mapItems.find((entry) => entry.id === id);
        if (!item) return;
        const related = item.relatedArticles?.[0];
        showUpdatePopup({
          lng: item.lng,
          lat: item.lat,
          kind: mapItemType(item),
          title: item.title,
          meta: `${item.status}　/　更新 ${item.updatedAt}`,
          target: related?.href || `/areas/${item.areaId}`,
          linkLabel: related ? "関連記事を見る" : "町丁目詳細を見る",
        });
        const linkedArea = areaFeature(item.areaId);
        if (linkedArea) selectAreaFeature(linkedArea, [item.lng, item.lat], false);
        showItemDetail(item);
        map.easeTo({ center: [item.lng, item.lat], zoom: Math.max(map.getZoom(), 15.3), duration: 700 });
      });
      map.on("mouseenter", "item-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "item-points", () => { map.getCanvas().style.cursor = ""; });
      window.ebinaMapFilter = (category) => {
        currentCategory = category;
        window.ebinaPendingMapCategory = category;
        const newsSource = map.getSource("news-points");
        const itemSource = map.getSource("items");
        if (newsSource) newsSource.setData(mapPointsGeoJSON(category));
        if (itemSource) itemSource.setData(mapItemsGeoJSON(category));
        persistMapState();
      };
      if (currentCategory) window.ebinaMapFilter(currentCategory);
    }).catch((error) => {
      showMapError(error);
    });
  }


  const geometryBounds = (geometry) => {
    const points = [];
    const visit = (value) => {
      if (Array.isArray(value) && typeof value[0] === "number") points.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
    };
    visit(geometry.coordinates);
    return points.reduce((bounds, point) => [
      [Math.min(bounds[0][0], point[0]), Math.min(bounds[0][1], point[1])],
      [Math.max(bounds[1][0], point[0]), Math.max(bounds[1][1], point[1])],
    ], [[Infinity, Infinity], [-Infinity, -Infinity]]);
  };

  function initAreaMiniMap() {
    const container = document.querySelector("#area-mini-map");
    const loading = document.querySelector("[data-area-mini-loading]");
    if (!container || !loading) return;
    const fail = (error) => {
      console.error("[町丁目詳細地図]", error);
      loading.hidden = false;
      loading.innerHTML = `<strong>地図を表示できませんでした</strong><small>${esc(error?.message || "地図の初期化に失敗しました")}</small><button class="button" type="button" data-map-retry>もう一度読み込む</button>`;
      loading.querySelector("[data-map-retry]")?.addEventListener("click", () => location.reload());
    };
    Promise.all([ensureMapGeo(), ensureMapLibre()]).then(([, maplibregl]) => {
      if (!document.body.contains(container)) return;
      const feature = areaFeature(container.dataset.areaId);
      if (!feature) throw new Error("選択した町丁目の詳細境界が見つかりません");
      const items = areaItems(feature.id);
      const sharedUpdates = areaSharedUpdates(feature.id);
      const bounds = geometryBounds(feature.geometry);
      const guideArea = container.dataset.mapMode === "editorial" ? guideData.areas[String(feature.id)] || null : null;
      const initialCenter = guideArea?.center || [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
      const mapItems = sharedUpdates.length ? [] : items;
      const itemData = { type: "FeatureCollection", features: mapItems.map((item) => ({ type: "Feature", id: item.id, properties: { id: item.id, title: item.title, status: item.status, updateType: mapItemType(item) === "その後、どうなった？" ? "followup" : "news", color: mapItemColor(item.status) }, geometry: { type: "Point", coordinates: [item.lng, item.lat] } })) };
      const sharedUpdateData = { type: "FeatureCollection", features: sharedUpdates.map((item) => ({ type: "Feature", id: item.id, properties: { id: item.id, title: item.title, kind: item.kind, updateType: item.type, target: item.target, color: item.color }, geometry: { type: "Point", coordinates: [item.lng, item.lat] } })) };
      const rectanglePolygon = (place) => {
        const [[west, south], [east, north]] = place.shape.bounds;
        return [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
      };
      const guidePlaces = (guideArea?.places || []).filter((place) => place.visibility === "published");
      const placeData = { type: "FeatureCollection", features: guidePlaces.filter((place) => !place.illustrationOnly).map((place) => ({
        type: "Feature",
        id: place.id,
        properties: { id: place.id, name: place.name, type: place.type, status: place.status, shapeType: place.shape.type, fillColor: place.shape.fillColor || "#FFFDF7" },
        geometry: place.shape.type === "point"
          ? { type: "Point", coordinates: [place.lng, place.lat] }
          : { type: "Polygon", coordinates: place.shape.type === "rectangle" ? rectanglePolygon(place) : place.shape.coordinates },
      })) };
      const skeletonLineData = { type: "FeatureCollection", features: [
        ...(guideArea?.skeleton.roads || []).map((road) => ({ type: "Feature", id: road.id, properties: { id: road.id, name: road.name, kind: "road", level: road.kind || "road" }, geometry: { type: "LineString", coordinates: road.coordinates } })),
        ...(guideArea?.skeleton.railways || []).map((railway) => ({ type: "Feature", id: railway.id, properties: { id: railway.id, name: railway.name, kind: "railway" }, geometry: { type: "LineString", coordinates: railway.coordinates } })),
        ...(guideArea?.skeleton.rivers || []).map((river) => ({ type: "Feature", id: river.id, properties: { id: river.id, name: river.name, kind: "river" }, geometry: { type: "LineString", coordinates: river.coordinates } })),
      ] };
      const parkData = { type: "FeatureCollection", features: (guideArea?.skeleton.parks || []).map((park) => ({ type: "Feature", id: park.id, properties: { id: park.id, name: park.name }, geometry: { type: "Polygon", coordinates: park.coordinates } })) };
      const allGuideRouteData = { type: "FeatureCollection", features: (guideArea?.accessRoutes || []).filter((route) => route.coordinates?.length >= 2).map((route) => ({ type: "Feature", id: route.id, properties: { id: route.id, name: route.name, color: route.color || "#CF6045", width: Number(route.width || 3) }, geometry: { type: "LineString", coordinates: route.coordinates } })) };
      const emptyRouteData = { type: "FeatureCollection", features: [] };
      const backgroundSources = guideArea ? {
        "guide-skeleton": { type: "geojson", data: skeletonLineData },
        "guide-parks": { type: "geojson", data: parkData },
        "guide-routes-all": { type: "geojson", data: allGuideRouteData },
        "guide-places": { type: "geojson", data: placeData },
        "guide-route": { type: "geojson", data: emptyRouteData },
      } : {
        "gsi-standard": { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"], tileSize: 256, minzoom: 5, maxzoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（国土地理院）</a>' },
      };
      const backgroundLayers = guideArea ? [
        { id: "guide-parks", type: "fill", source: "guide-parks", paint: { "fill-color": "#A9C7A5", "fill-opacity": 0.46, "fill-outline-color": "#91B18E" } },
        { id: "guide-roads", type: "line", source: "guide-skeleton", filter: ["==", ["get", "kind"], "road"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["==", ["get", "level"], "major-road"], "#C5AF84", "#D8C8A8"], "line-opacity": 0.92, "line-width": ["interpolate", ["linear"], ["zoom"], 14, ["case", ["==", ["get", "level"], "major-road"], 2.8, 1.5], 18, ["case", ["==", ["get", "level"], "major-road"], 6, 3.5]] } },
        { id: "guide-railway", type: "line", source: "guide-skeleton", filter: ["==", ["get", "kind"], "railway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#183252", "line-width": 2.2, "line-opacity": 0.92 } },
        { id: "guide-rivers", type: "line", source: "guide-skeleton", filter: ["==", ["get", "kind"], "river"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#BFD9DD", "line-width": 7, "line-opacity": 0.78 } },
        { id: "guide-routes-all", type: "line", source: "guide-routes-all", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["coalesce", ["get", "color"], "#CF6045"], "line-width": ["coalesce", ["get", "width"], 3], "line-opacity": 0.88 } },
        { id: "guide-place-fill", type: "fill", source: "guide-places", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["coalesce", ["get", "fillColor"], "#FFFDF7"], "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.94] } },
        { id: "guide-place-outline", type: "line", source: "guide-places", filter: ["==", ["geometry-type"], "Polygon"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#CF6045", "#CEC5B5"], "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.2, 1.2] } },
        { id: "guide-place-points", type: "circle", source: "guide-places", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#CF6045", "#FFFDF7"], "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 7, 5], "circle-stroke-color": "#CF6045", "circle-stroke-width": 1.5 } },
        { id: "guide-route", type: "line", source: "guide-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["coalesce", ["get", "color"], "#CF6045"], "line-width": ["coalesce", ["get", "width"], 3], "line-opacity": 0.78, "line-dasharray": [1, 1.8] } },
      ] : [
        { id: "detail-background", type: "raster", source: "gsi-standard", paint: { "raster-opacity": 0.96 } },
      ];
      const detailStyle = {
        version: 8,
        sources: {
          ...backgroundSources,
          "selected-area": { type: "geojson", data: { type: "FeatureCollection", features: [feature] } },
          "area-items": { type: "geojson", data: itemData },
          "shared-updates": { type: "geojson", data: sharedUpdateData },
        },
        layers: [
          { id: "paper", type: "background", paint: { "background-color": guideArea ? "#F7F3E8" : "#f7f3e9" } },
          ...backgroundLayers,
          { id: "selected-area-fill", type: "fill", source: "selected-area", paint: { "fill-color": "#CF6045", "fill-opacity": guideArea ? 0.008 : 0.035 } },
          { id: "selected-area-line", type: "line", source: "selected-area", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": guideArea ? "#CF6045" : "#c94731", "line-width": guideArea ? 1.25 : 3, "line-opacity": guideArea ? 0.48 : 1, ...(guideArea ? { "line-dasharray": [1.5, 2.2] } : {}) } },
          { id: "area-item-halo", type: "circle", source: "area-items", paint: { "circle-color": ["get", "color"], "circle-radius": 15, "circle-opacity": 0.18 } },
          { id: "area-item-points", type: "circle", source: "area-items", paint: { "circle-color": ["get", "color"], "circle-radius": 8, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
          { id: "shared-update-halo", type: "circle", source: "shared-updates", paint: { "circle-color": ["get", "color"], "circle-radius": 17, "circle-opacity": 0.2 } },
          { id: "shared-update-points", type: "circle", source: "shared-updates", paint: { "circle-color": ["get", "color"], "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
        ],
      };
      let map;
      try {
        map = new maplibregl.Map({ container, center: initialCenter, zoom: guideArea?.initialZoom || 16, minZoom: 14, maxZoom: 18, dragRotate: false, pitchWithRotate: false, attributionControl: true, style: detailStyle });
      } catch (error) { fail(error); return; }
      window.ebinaInteractiveMap = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      const guideDetail = document.querySelector("[data-guide-map-detail]");
      const defaultGuideDetailMarkup = guideDetail?.innerHTML || "";
      const applyAreaUpdateFilter = (type) => {
        guideDetail?.querySelectorAll("[data-area-update-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.areaUpdateFilter === type));
        guideDetail?.querySelectorAll("[data-area-update-type]").forEach((row) => row.toggleAttribute("hidden", type !== "all" && row.dataset.areaUpdateType !== type));
        const filter = type === "all" ? null : ["==", ["get", "updateType"], type];
        ["area-item-halo", "area-item-points", "shared-update-halo", "shared-update-points"].forEach((layer) => { if (map.getLayer(layer)) map.setFilter(layer, filter); });
      };
      guideDetail?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-area-update-filter]");
        if (button) applyAreaUpdateFilter(button.dataset.areaUpdateFilter);
      });
      const guidePlaceType = { station: "駅", exit: "駅出口", "commercial-facility": "商業施設", shop: "登録店舗", "public-facility": "公共施設", construction: "工事現場", venue: "イベント会場", park: "公園", place: "登録場所" };
      const guideIconMarkup = (kind) => {
        const icons = {
          station: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="3"></rect><path d="M8 7h8M8 12h8M9 19l-2 2m8-2 2 2"></path></svg>',
          exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h10v17M9 12h10m-3-3 3 3-3 3"></path></svg>',
          "commercial-facility": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 9h2m4 0h2M8 13h2m4 0h2M10 20v-4h4v4"></path></svg>',
          shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-2-5H6L4 9Z"></path><path d="M6 9v11h12V9M9 20v-6h6v6"></path></svg>',
          "public-facility": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18L12 3 3 9Zm2 11h14M7 9v8m5-8v8m5-8v8"></path></svg>',
          construction: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8 16H4L12 4Zm-4 10h8"></path></svg>',
          venue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3m0 2h11l-3 4 3 4H6"></path></svg>',
          park: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 7 11h3l-4 6h5v4h2v-4h5l-4-6h3l-5-8Z"></path></svg>',
          place: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12Z"></path><circle cx="12" cy="9" r="2"></circle></svg>',
        };
        return icons[kind] || icons.shop;
      };
      const emptyGuideCard = () => defaultGuideDetailMarkup || `<p class="eyebrow">PLACE GUIDE</p><h3>建物や場所を選んでください</h3><p>登録された建物を押すと、入口、アクセス方法、おすすめ経路、関連記事を確認できます。</p>`;
      let selectedGuidePlaceId = null;
      const clearGuideSelection = () => {
        const routeSource = map.getSource("guide-route");
        if (routeSource) routeSource.setData(emptyRouteData);
        const selectedPlace = guidePlaces.find((entry) => entry.id === selectedGuidePlaceId);
        if (selectedGuidePlaceId && !selectedPlace?.illustrationOnly) map.setFeatureState({ source: "guide-places", id: selectedGuidePlaceId }, { selected: false });
        selectedGuidePlaceId = null;
        if (guideDetail) guideDetail.innerHTML = emptyGuideCard();
      };
      const showGuidePlace = (place) => {
        if (!guideArea || !place) return;
        const previousPlace = guidePlaces.find((entry) => entry.id === selectedGuidePlaceId);
        if (selectedGuidePlaceId && selectedGuidePlaceId !== place.id && !previousPlace?.illustrationOnly) map.setFeatureState({ source: "guide-places", id: selectedGuidePlaceId }, { selected: false });
        selectedGuidePlaceId = place.id;
        if (!place.illustrationOnly) map.setFeatureState({ source: "guide-places", id: selectedGuidePlaceId }, { selected: true });
        const route = guideArea.accessRoutes.find((entry) => entry.id === place.routeId);
        const routeSource = map.getSource("guide-route");
        if (routeSource) routeSource.setData({ type: "FeatureCollection", features: route ? [{ type: "Feature", id: route.id, properties: { id: route.id, name: route.name, color: route.color || "#CF6045", width: Number(route.width || 3) }, geometry: { type: "LineString", coordinates: route.coordinates } }] : [] });
        const articles = (place.relatedNewsIds || []).map((newsId) => data.news.find((entry) => entry.id === newsId)).filter(Boolean);
        const facilities = Array.isArray(place.facilities) ? place.facilities : [];
        const articleLinks = (rows, emptyText) => rows.length ? rows.map((article) => `<a href="${href(`/news/${article.id}`)}">${esc(article.title)} →</a>`).join("") : `<small>${esc(emptyText)}</small>`;
        const facilityMarkup = facilities.length ? `<div class="guide-building-facilities"><strong>この建物に入っている施設</strong>${facilities.map((facility) => `<div class="guide-facility-summary"><b>${esc(facility.name)}</b><span>${esc(facility.category || "施設")}</span>${facility.address ? `<small>${esc(facility.address)}</small>` : ""}${facility.sourceUrl ? `<a href="${esc(facility.sourceUrl)}" target="_blank" rel="noopener">施設情報の出典 →</a>` : ""}</div>`).join("")}</div>` : "";
        const relatedArticleMarkup = articles.length ? `<div class="guide-place-articles"><strong>この場所に紐づく関連記事</strong>${articleLinks(articles, "")}</div>` : "";
        const demoLabel = place.status === "demo" ? `<span class="map-detail-demo">デモ登録</span>` : "";
        if (guideDetail) {
          const showIllustration = place.illustrationOnly && optionalLandmarkAssetFile(place.illustrationPath);
          guideDetail.innerHTML = `<button class="guide-card-close" type="button" data-guide-card-close aria-label="場所の詳細を閉じる">×</button><p class="eyebrow">REGISTERED PLACE</p>${demoLabel}<div class="guide-card-title ${showIllustration ? "has-illustration" : ""}">${showIllustration ? guidePlaceIllustration(place.illustrationPath, place.name) : `<span class="guide-card-icon">${guideIconMarkup(place.type)}</span>`}<h3>${esc(place.name)}</h3></div><p class="guide-place-address">${esc(place.address)}</p><dl class="guide-place-meta"><div><dt>種類</dt><dd>${esc(guidePlaceType[place.type] || place.type)}</dd></div><div><dt>状態</dt><dd>${esc(place.status)}</dd></div><div><dt>最寄り</dt><dd>${esc((place.nearestTransit || []).join("・") || "未設定")}</dd></div></dl><p>${esc(place.accessDescription || "アクセス情報は準備中です。")}</p>${route ? `<div class="guide-route-note"><strong>${esc(route.name)}</strong><span>${esc(route.description || "編集部おすすめの案内経路です。")}</span></div>${route.externalMapUrl ? `<a class="button guide-external-route" href="${esc(route.externalMapUrl)}" target="_blank" rel="noopener">外部地図で経路を開く</a>` : ""}` : ""}${facilityMarkup}${relatedArticleMarkup}`;
          guideDetail.querySelector("[data-guide-card-close]")?.addEventListener("click", clearGuideSelection);
        }
        map.easeTo({ center: [place.entrancePosition.lng, place.entrancePosition.lat], zoom: Math.max(map.getZoom(), 16.7), duration: 500 });
      };
      const fitArea = (duration = 500) => map.fitBounds(bounds, { padding: 54, duration, maxZoom: 15.6 });
      document.querySelector("[data-area-map-fit]")?.addEventListener("click", () => fitArea());
      requestAnimationFrame(() => { if (document.body.contains(container)) map.resize(); });
      map.on("load", () => {
        loading.hidden = true;
        if (guideArea) {
          (guideArea.skeleton.landmarks || []).forEach((landmark) => {
            const element = document.createElement("span");
            element.className = `guide-map-marker guide-map-marker--${landmark.kind}`;
            element.innerHTML = `<span class="guide-marker-icon">${guideIconMarkup(landmark.kind)}</span><span class="guide-marker-name">${esc(landmark.name)}</span>`;
            element.setAttribute("aria-label", landmark.name);
            const landmarkOffset = landmark.id === "ebina-station" ? [-52, -12] : landmark.id === "ebina-east-exit" ? [34, 22] : [-34, 24];
            new maplibregl.Marker({ element, anchor: "center", offset: landmarkOffset }).setLngLat([landmark.lng, landmark.lat]).addTo(map);
          });
          guidePlaces.forEach((place) => {
            const element = document.createElement("button");
            element.type = "button";
            const hasIllustration = Boolean(place.illustrationOnly && optionalLandmarkAssetFile(place.illustrationPath));
            element.className = `guide-map-marker guide-map-marker--place${hasIllustration ? " has-illustration" : ""}${place.illustrationOnly ? " is-illustration-only" : ""}${place.status === "demo" ? " is-demo" : ""}${place.labelMode === "interactive" && !hasIllustration ? " is-label-interactive" : ""}`;
            element.innerHTML = hasIllustration ? `<span class="guide-marker-illustration">${guidePlaceIllustration(place.illustrationPath)}</span><span class="guide-marker-name">${esc(place.name)}</span>` : `<span class="guide-marker-icon">${guideIconMarkup(place.type)}</span><span class="guide-marker-name">${esc(place.name)}</span>`;
            element.setAttribute("aria-label", `${place.name}の案内を見る`);
            element.addEventListener("click", () => showGuidePlace(place));
            const savedOffset = Array.isArray(place.labelOffset) && place.labelOffset.some((value) => Number(value) !== 0) ? place.labelOffset.map(Number) : null;
            const placeOffset = place.illustrationOnly ? [0, 0] : savedOffset || (place.id === "place-vinawalk" ? [46, 25] : place.id === "place-ebina-marui" ? [48, -24] : [42, 25]);
            const position = place.illustrationOnly ? [place.lng, place.lat] : [place.entrancePosition.lng, place.entrancePosition.lat];
            new maplibregl.Marker({ element, anchor: place.illustrationOnly ? "bottom" : "center", offset: placeOffset }).setLngLat(position).addTo(map);
          });
        }
        requestAnimationFrame(() => {
          map.resize();
          requestAnimationFrame(() => map.resize());
        });
      });
      map.on("error", (event) => {
        const error = event.error || new Error("詳細地図の読み込み中にエラーが発生しました");
        const tileError = Boolean(event.tile) || event.sourceId === "gsi-standard" || /cyberjapandata|\/xyz\/std\//i.test(error.message || "");
        if (!tileError && !map.loaded()) fail(error);
      });
      if (guideArea) {
        const activateGuideFeature = (event) => {
          const id = event.features?.[0]?.properties?.id;
          showGuidePlace(guidePlaces.find((place) => place.id === id));
        };
        map.on("click", "guide-place-fill", activateGuideFeature);
        map.on("click", "guide-place-points", activateGuideFeature);
        ["guide-place-fill", "guide-place-points"].forEach((layer) => {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        });
      }
      map.on("click", "shared-update-points", (event) => {
        const update = sharedUpdates.find((entry) => entry.id === event.features?.[0]?.properties?.id);
        if (!update) return;
        new maplibregl.Popup({ maxWidth: "320px" }).setLngLat([update.lng, update.lat]).setHTML(`<div class="area-map-popup"><small>${esc(update.kind)}</small><strong>${esc(update.title)}</strong><span>${esc(update.date)}</span><a href="${href(update.target)}">詳しく見る →</a></div>`).addTo(map);
      });
      map.on("mouseenter", "shared-update-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "shared-update-points", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", "area-item-points", (event) => {
        const item = items.find((entry) => entry.id === event.features?.[0]?.properties?.id); if (!item) return;
        const article = item.relatedArticles?.[0];
        const articleLink = article ? `<a href="${href(article.href)}">${esc(article.label)} →</a>` : "";
        if (guideArea && guideDetail) {
          clearGuideSelection();
          guideDetail.innerHTML = `<button class="guide-card-close" type="button" data-guide-card-close aria-label="地点の詳細を閉じる">×</button><p class="eyebrow">LOCAL UPDATE</p><span class="map-detail-demo">デモデータ</span><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><div class="guide-route-note"><strong>${esc(item.status)}</strong><span>${esc(item.updatedAt)} 更新</span></div>${articleLink ? `<div class="guide-place-articles"><strong>関連記事</strong>${articleLink}</div>` : ""}`;
          guideDetail.querySelector("[data-guide-card-close]")?.addEventListener("click", clearGuideSelection);
        } else {
          new maplibregl.Popup({ maxWidth: "300px" }).setLngLat([item.lng, item.lat]).setHTML(`<div class="area-map-popup"><small>デモデータ・${esc(item.status)}</small><strong>${esc(item.title)}</strong><span>${esc(item.updatedAt)} 更新</span>${articleLink}</div>`).addTo(map);
        }
      });
      map.on("mouseenter", "area-item-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "area-item-points", () => { map.getCanvas().style.cursor = ""; });
    }).catch(fail);
  }

  let turnstileLoader = null;
  const loadTurnstile = () => {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error("迷惑投稿対策を読み込めませんでした"));
      document.head.appendChild(script);
    });
    return turnstileLoader;
  };

  const setSubmissionMessage = (form, message, state = "") => {
    const output = form.querySelector("[data-form-message]");
    if (!output) return;
    output.textContent = message;
    output.className = `form-message is-visible${state ? ` is-${state}` : ""}`;
  };

  async function initSubmissionForm() {
    const form = document.querySelector("[data-submission-form]");
    const container = form?.querySelector("[data-turnstile-container]");
    if (!form || previewMode || !container || !publicConfig.turnstileSiteKey) return;
    try {
      const turnstile = await loadTurnstile();
      if (!document.body.contains(form) || !turnstile) return;
      const tokenInput = form.elements.turnstileToken;
      const submitButton = form.querySelector('[type="submit"]');
      const widgetId = turnstile.render(container, {
        sitekey: publicConfig.turnstileSiteKey,
        language: "ja",
        action: "submit-information",
        callback: (token) => { tokenInput.value = token; submitButton.disabled = false; },
        "expired-callback": () => { tokenInput.value = ""; submitButton.disabled = true; },
        "error-callback": () => { tokenInput.value = ""; submitButton.disabled = true; setSubmissionMessage(form, "迷惑投稿対策の確認に失敗しました。再読み込みしてください。", "error"); },
      });
      form.dataset.turnstileWidget = String(widgetId);
    } catch (error) {
      form.querySelector('[type="submit"]')?.setAttribute("disabled", "");
      setSubmissionMessage(form, error.message || "受付機能を読み込めませんでした。", "error");
    }
  }

  async function submitInformation(form) {
    if (!form.reportValidity()) return;
    if (previewMode) {
      setSubmissionMessage(form, "プレビューのため送信されていません。入力内容も保存されません。", "preview");
      return;
    }
    const button = form.querySelector('[type="submit"]');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "送信中…";
    try {
      const values = new FormData(form);
      const submissionType = form.dataset.submissionType;
      const sourceUrl = String(values.get("sourceUrl") || "").trim();
      const payload = {
        submissionType,
        senderName: values.get("senderName"),
        senderContact: values.get("senderContact"),
        category: submissionType === "correction" ? "訂正依頼" : values.get("category"),
        title: submissionType === "correction" ? `訂正依頼：${sourceUrl}` : values.get("title"),
        sourceUrl,
        summary: values.get("summary"),
        consent: values.get("consent") === "yes",
        website: values.get("website"),
        turnstileToken: values.get("turnstileToken"),
      };
      const functionName = publicConfig.submissionFunctionName || "submit-information";
      const response = await fetch(`${publicConfig.supabaseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: { apikey: publicConfig.supabaseAnonKey, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "送信を受け付けられませんでした。");
      form.reset();
      setSubmissionMessage(form, "送信を受け付けました。内容を確認し、必要な場合はご連絡します。", "success");
    } catch (error) {
      setSubmissionMessage(form, error.message || "送信できませんでした。時間をおいて再度お試しください。", "error");
    } finally {
      if (window.turnstile && form.dataset.turnstileWidget) window.turnstile.reset(form.dataset.turnstileWidget);
      button.disabled = !previewMode;
      button.textContent = originalLabel;
    }
  }

  function bindInteractions() {
    const panel = document.querySelector(".search-panel");
    const searchToggle = document.querySelector(".search-toggle");
    const searchClose = document.querySelector(".search-close");
    let searchReturnFocus = null;
    const closeSearch = () => {
      if (!panel?.classList.contains("is-open")) return;
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      searchToggle?.setAttribute("aria-expanded", "false");
      if (searchReturnFocus?.isConnected) searchReturnFocus.focus();
    };
    const openSearch = () => {
      if (!panel) return;
      searchReturnFocus = document.activeElement;
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
      searchToggle?.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => panel.querySelector("input")?.focus());
    };
    const homeTownMap = document.querySelector("[data-home-town-map-link]");
    homeTownMap?.addEventListener("click", (event) => { if (!event.target.closest("a")) navigate("/map"); });
    homeTownMap?.addEventListener("keydown", (event) => { if (event.target === homeTownMap && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); navigate("/map"); } });
    document.querySelectorAll("[data-area-map-mode]").forEach((button) => button.addEventListener("click", () => {
      if (button.classList.contains("is-active")) return;
      const scrollY = window.scrollY;
      window.ebinaAreaMapMode = button.dataset.areaMapMode;
      render();
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }));
    searchToggle?.addEventListener("click", openSearch);
    searchClose?.addEventListener("click", closeSearch);
    panel?.addEventListener("click", (e) => { if (e.target === panel) closeSearch(); });
    panel?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    const menuButton = document.querySelector(".menu-button");
    menuButton?.addEventListener("click", () => { const menu = document.querySelector(".mobile-menu"); const open = menu.classList.toggle("is-open"); menuButton.setAttribute("aria-expanded", String(open)); });
    document.querySelectorAll("[data-search-form]").forEach((form) => form.addEventListener("submit", (e) => { e.preventDefault(); const q = new FormData(form).get("q"); navigate(`/search?q=${encodeURIComponent(q)}`); }));
    document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => { const category = button.dataset.category; navigate(category === "all" ? "/news" : `/news?category=${category}`); }));
    document.querySelectorAll("[data-map-filter]").forEach((button) => button.addEventListener("click", () => {
      const category = button.dataset.mapFilter;
      document.querySelectorAll("[data-map-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      window.ebinaPendingMapCategory = category;
      if (window.ebinaMapFilter) window.ebinaMapFilter(category);
    }));
    document.querySelector("[data-map-restore]")?.addEventListener("click", () => { window.ebinaRestoreRequested = true; });
    const mapGuide = document.querySelector("[data-map-operation-guide]");
    try { mapGuide?.toggleAttribute("hidden", window.localStorage?.getItem(MAP_GUIDE_KEY) === "1"); } catch (_) { /* file preview may block storage */ }
    document.querySelector("[data-close-map-guide]")?.addEventListener("click", () => {
      mapGuide?.setAttribute("hidden", "");
      try { window.localStorage?.setItem(MAP_GUIDE_KEY, "1"); } catch (_) { /* file preview may block storage */ }
    });
    const areaSelect = document.querySelector("[data-keyboard-area-select]");
    const openSelectedArea = () => {
      const id = areaSelect?.value;
      if (!id) { areaSelect?.focus(); return; }
      if (window.ebinaOpenAreaPage) window.ebinaOpenAreaPage(id);
      else navigate(`/areas/${id}`);
    };
    document.querySelector("[data-keyboard-area-open]")?.addEventListener("click", openSelectedArea);
    areaSelect?.addEventListener("keydown", (event) => { if (event.key === "Enter" && areaSelect.value) { event.preventDefault(); openSelectedArea(); } });
    document.querySelector("[data-submission-form]")?.addEventListener("submit", (event) => { event.preventDefault(); submitInformation(event.currentTarget); });
    initAreaMap();
    initAreaMiniMap();
    initSubmissionForm();
  }

  const legacyTarget = router.legacyHashTarget(location);
  if (legacyTarget) window.history.replaceState({ ...(window.history.state || {}) }, "", legacyTarget);
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;
    const target = new URL(rawHref, location.href);
    if (target.origin !== location.origin || !["http:", "https:"].includes(target.protocol)) return;
    event.preventDefault();
    navigate(`${target.pathname}${target.search}${target.hash}`);
  });
  window.addEventListener("popstate", render);
  render();
})();
