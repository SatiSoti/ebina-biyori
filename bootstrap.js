(() => {
  const fallbackData = window.EBINA_DATA;
  const fallbackGuideData = window.EBINA_GUIDE_DATA || { version: 1, areas: {} };
  const fallbackLandmarkData = window.EBINA_CITY_LANDMARKS || { version: 1, source: "static-fallback", items: [] };
  const config = window.EBINA_PUBLIC_CONFIG || {};
  const appRoot = document.querySelector("#app");
  const previewMode = config.previewMode === true || location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  const publicBaseData = previewMode ? fallbackData : { ...fallbackData, news: [], mapPoints: [], mapItems: [], followups: [], issues: [] };
  const publicBaseGuide = previewMode ? fallbackGuideData : { version: 2, source: "public", areas: {}, statuses: {} };
  window.EBINA_DATA = publicBaseData;
  window.EBINA_GUIDE_DATA = publicBaseGuide;
  window.EBINA_CITY_LANDMARKS = fallbackLandmarkData;
  window.EBINA_PUBLIC_STATE = { mode: previewMode ? "demo" : "empty", previewMode, connected: false, publishedCount: 0, guideConnected: false, publishedGuideCount: 0, landmarksConnected: false, publishedLandmarkCount: fallbackLandmarkData.items?.length || 0, error: null, guideError: null, landmarksError: null };

  const formatDate = (value) => {
    if (!value) return "未設定";
    const [year, month, day] = String(value).split("-").map(Number);
    return year && month && day ? `${year}年${month}月${day}日` : String(value);
  };
  const categoryTone = (category) => ({ development: "orange", shops: "orange", government: "teal", transport: "blue", events: "orange", welfare: "teal", disaster: "amber" })[category] || "teal";
  const splitBody = (body) => String(body || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const loadApp = () => {
    const script = document.createElement("script");
    script.src = "./app.js?v=guide-illustrations-20";
    document.body.appendChild(script);
  };

  const loadPublishedNews = async () => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Supabaseの公開設定がありません");
    const select = "id,slug,title,category,excerpt,body,published_at,checked_at,area_id,location_name,latitude,longitude,show_on_map,is_important,image_path,article_sources(source_type,source_name,source_url,checked_at,sort_order)";
    const params = new URLSearchParams({ select, status: "eq.published", deleted_at: "is.null", order: "published_at.desc" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/news?${params}`, {
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`公開記事を取得できませんでした (${response.status})`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  };

  const fetchPublicTable = async (table, params, signal) => {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${params}`, {
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      signal,
    });
    if (!response.ok) throw new Error(`${table}を取得できませんでした (${response.status})`);
    return response.json();
  };

  const loadPublishedGuide = async () => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Supabaseの公開設定がありません");
    const placeParams = new URLSearchParams({
      select: "id,name,address,area_id,latitude,longitude,place_type,current_status,entrance_latitude,entrance_longitude,shape_type,shape_geojson,icon,access_description,nearest_transit,visibility,label_offset_x,label_offset_y,display_enabled,updated_at",
      visibility: "eq.published", display_enabled: "eq.true", deleted_at: "is.null", order: "updated_at.desc",
    });
    const routeParams = new URLSearchParams({
      select: "id,guide_place_id,name,origin_name,origin_latitude,origin_longitude,route_geojson,walking_minutes,distance_meters,instructions,external_map_url,visibility,sort_order,updated_at",
      visibility: "eq.published", deleted_at: "is.null", order: "sort_order.asc",
    });
    const linkParams = new URLSearchParams({ select: "news_id,guide_place_id,relation_type" });
    const statusParams = new URLSearchParams({ select: "area_id,status,public_message,updated_at" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const [places, routes, links, statuses] = await Promise.all([
        fetchPublicTable("guide_places", placeParams, controller.signal),
        fetchPublicTable("guide_routes", routeParams, controller.signal),
        fetchPublicTable("article_guide_places", linkParams, controller.signal),
        fetchPublicTable("guide_map_areas", statusParams, controller.signal).catch((error) => { console.warn("[EBINA UPDATE] 案内図の制作状況を取得できませんでした", error); return []; }),
      ]);
      return { places, routes, links, statuses };
    } finally { clearTimeout(timeout); }
  };

  const loadPublishedLandmarks = async () => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Supabaseの公開設定がありません");
    const params = new URLSearchParams({
      select: "id,name,category,description,latitude,longitude,default_zoom,image_path,color,sort_order,enabled,updated_at",
      visibility: "eq.published",
      enabled: "eq.true",
      order: "sort_order.asc",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      return await fetchPublicTable("city_landmarks", params, controller.signal);
    } finally { clearTimeout(timeout); }
  };

  const applyPublishedNews = (rows) => {
    const towns = window.EBINA_AREAS?.towns || [];
    const news = rows.map((row) => {
      const sources = [...(row.article_sources || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const primarySource = sources[0] || {};
      return {
        id: row.slug,
        databaseId: row.id,
        category: row.category,
        title: row.title,
        excerpt: row.excerpt,
        publishedAt: formatDate(row.published_at),
        checkedAt: formatDate(row.checked_at),
        sourceType: primarySource.source_type || "情報元",
        source: primarySource.source_name || "情報元未登録",
        sourceUrl: primarySource.source_url || "",
        sources: sources.map((source) => ({ type: source.source_type, name: source.source_name, url: source.source_url || "", checkedAt: formatDate(source.checked_at) })),
        important: Boolean(row.is_important),
        body: splitBody(row.body),
        areaId: row.area_id,
        locationName: row.location_name,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        showOnMap: Boolean(row.show_on_map),
        imagePath: row.image_path || "",
      };
    });
    const mapPoints = news.filter((item) => item.showOnMap && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map((item) => {
      const town = towns.find((entry) => String(entry.id) === String(item.areaId));
      return {
        id: `news-${item.databaseId}`,
        lat: item.latitude,
        lng: item.longitude,
        town: town?.base || town?.name || item.locationName || "海老名市",
        area: item.locationName || town?.name || "海老名市内",
        areaId: item.areaId,
        category: item.category,
        kind: "ニュース",
        label: item.title,
        target: `/news/${item.id}`,
        tone: categoryTone(item.category),
      };
    });
    const latestCheckedAt = rows.map((row) => row.checked_at).filter(Boolean).sort().at(-1);
    window.EBINA_DATA = { ...publicBaseData, site: { ...fallbackData.site, lastUpdated: formatDate(latestCheckedAt) }, news, mapPoints };
  };

  const guidePlaceType = (row) => ({
    "駅": "station", "駅出口": "exit", "商業施設": "commercial-facility", "店舗": "shop",
    "公共施設": "public-facility", "工事現場": "construction", "イベント会場": "venue", "公園": "park", "その他": "place",
  })[row.place_type] || ({ station: "station", exit: "exit", shopping: "commercial-facility", shop: "shop", public: "public-facility", construction: "construction", event: "venue", park: "park" })[row.icon] || "place";

  const shapeBounds = (geometry) => {
    const points = [];
    const visit = (value) => {
      if (Array.isArray(value) && typeof value[0] === "number") points.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
    };
    visit(geometry?.coordinates || []);
    if (!points.length) return null;
    return points.reduce((bounds, point) => [
      [Math.min(bounds[0][0], point[0]), Math.min(bounds[0][1], point[1])],
      [Math.max(bounds[1][0], point[0]), Math.max(bounds[1][1], point[1])],
    ], [[Infinity, Infinity], [-Infinity, -Infinity]]);
  };

  const publicPlaceShape = (row) => {
    const fillColor = /^#[0-9a-f]{6}$/i.test(String(row.shape_geojson?.properties?.fillColor || "")) ? row.shape_geojson.properties.fillColor : "#FFFDF7";
    if (["rectangle", "polygon"].includes(row.shape_type) && row.shape_geojson?.coordinates) return { type: "polygon", coordinates: row.shape_geojson.coordinates, fillColor };
    return { type: "point", fillColor };
  };

  const applyPublishedGuide = ({ places, routes, links, statuses = [] }) => {
    const towns = window.EBINA_AREAS?.towns || [];
    const newsByDatabaseId = new Map((window.EBINA_DATA?.news || []).map((item) => [String(item.databaseId), item.id]));
    const relatedNewsByPlace = new Map();
    links.forEach((link) => {
      const slug = newsByDatabaseId.get(String(link.news_id));
      if (!slug) return;
      const id = String(link.guide_place_id);
      if (!relatedNewsByPlace.has(id)) relatedNewsByPlace.set(id, []);
      relatedNewsByPlace.get(id).push(slug);
    });
    const routesByPlace = new Map();
    routes.forEach((route) => {
      const id = String(route.guide_place_id);
      if (!routesByPlace.has(id)) routesByPlace.set(id, []);
      routesByPlace.get(id).push(route);
    });
    const areas = {};
    places.forEach((row) => {
      const areaId = String(row.area_id);
      const town = towns.find((entry) => String(entry.id) === areaId);
      if (!areas[areaId]) {
        areas[areaId] = {
          areaId, name: town?.name || "町丁目", center: [Number(row.longitude), Number(row.latitude)], initialZoom: 16.4, source: "supabase",
          skeleton: { roads: [], railways: [], rivers: [], parks: [], landmarks: [] }, places: [], accessRoutes: [],
        };
      }
      const placeRoutes = routesByPlace.get(String(row.id)) || [];
      const firstRoute = placeRoutes.find((route) => (route.route_geojson?.kind || "guide") === "guide") || null;
      areas[areaId].places.push({
        id: String(row.id), name: row.name, address: row.address || "", areaId,
        lat: Number(row.latitude), lng: Number(row.longitude), type: guidePlaceType(row), status: row.current_status || "公開中",
        entrancePosition: {
          lat: row.entrance_latitude == null ? Number(row.latitude) : Number(row.entrance_latitude),
          lng: row.entrance_longitude == null ? Number(row.longitude) : Number(row.entrance_longitude),
        },
        shape: publicPlaceShape(row), icon: row.icon || "place", illustrationPath: row.shape_geojson?.properties?.illustrationPath || "", accessDescription: row.access_description || "",
        nearestTransit: Array.isArray(row.nearest_transit) ? row.nearest_transit : [],
        relatedNewsIds: relatedNewsByPlace.get(String(row.id)) || [], visibility: "published",
        routeId: firstRoute ? String(firstRoute.id) : null,
        facilities: Array.isArray(row.shape_geojson?.properties?.facilities) ? row.shape_geojson.properties.facilities : [],
        labelMode: row.shape_geojson?.properties?.labelMode === "interactive" ? "interactive" : "always",
        labelOffset: [Number(row.label_offset_x || 0), Number(row.label_offset_y || 0)],
        positionSource: "海老名びより編集部登録",
      });
      placeRoutes.forEach((route) => {
        if (!route.route_geojson?.coordinates?.length) return;
        const kind = route.route_geojson.kind || "guide";
        if (kind === "road") { areas[areaId].skeleton.roads.push({ id: String(route.id), name: route.name || "道路", kind: "major-road", coordinates: route.route_geojson.coordinates }); return; }
        if (kind === "rail") { areas[areaId].skeleton.railways.push({ id: String(route.id), name: route.name || "鉄道", coordinates: route.route_geojson.coordinates }); return; }
        const instructions = Array.isArray(route.instructions) ? route.instructions.join(" ") : "";
        areas[areaId].accessRoutes.push({
          id: String(route.id), name: route.name || "おすすめ経路", fromPlaceId: route.origin_name || "出発地点", toPlaceId: String(row.id),
          description: instructions || [route.walking_minutes ? `徒歩約${route.walking_minutes}分` : "", route.distance_meters ? `約${route.distance_meters}m` : ""].filter(Boolean).join("・"),
          coordinates: route.route_geojson.coordinates, color: route.route_geojson.color || "#CF6045", width: Number(route.route_geojson.width || 3), externalMapUrl: route.external_map_url || "",
        });
      });
    });
    const areaStatuses = Object.fromEntries(statuses.map((row) => [String(row.area_id), { status: row.status || "not_started", message: row.public_message || "", updatedAt: row.updated_at || "" }]));
    Object.keys(areas).forEach((areaId) => { if (!areaStatuses[areaId]) areaStatuses[areaId] = { status: "building", message: "編集部の手作り案内図を更新しています。", updatedAt: "" }; });
    window.EBINA_GUIDE_DATA = { version: 3, source: "supabase", areas, statuses: areaStatuses };
  };

  const applyPublishedLandmarks = (rows) => {
    window.EBINA_CITY_LANDMARKS = {
      version: 2,
      source: "supabase",
      items: rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        category: row.category,
        description: row.description || "",
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        zoom: Number(row.default_zoom || 14.2),
        imagePath: row.image_path || "ebina-station.svg",
        color: row.color || "#1c3966",
        sortOrder: Number(row.sort_order || 0),
        enabled: row.enabled !== false,
      })),
    };
  };

  if (appRoot) appRoot.innerHTML = '<main class="public-loading" aria-live="polite">公開記事・案内図・目印を読み込んでいます…</main>';
  Promise.allSettled([loadPublishedNews(), loadPublishedGuide(), loadPublishedLandmarks()]).then(([newsResult, guideResult, landmarksResult]) => {
    const newsRows = newsResult.status === "fulfilled" ? newsResult.value : [];
    const landmarkRows = landmarksResult.status === "fulfilled" ? landmarksResult.value : [];
    if (newsResult.status === "fulfilled" && (newsRows.length || !previewMode)) applyPublishedNews(newsRows);
    if (guideResult.status === "fulfilled") applyPublishedGuide(guideResult.value);
    if (landmarksResult.status === "fulfilled" && landmarkRows.length) applyPublishedLandmarks(landmarkRows);
    if (newsResult.status === "rejected") console.error("[EBINA UPDATE] 公開記事の読み込みに失敗しました", newsResult.reason);
    if (guideResult.status === "rejected") console.error("[EBINA UPDATE] 公開案内図の読み込みに失敗しました", guideResult.reason);
    if (landmarksResult.status === "rejected") console.warn("[EBINA UPDATE] 公開目印の読み込みに失敗したため、同梱データを表示します", landmarksResult.reason);
    window.EBINA_PUBLIC_STATE = {
      mode: newsResult.status === "rejected" ? "error" : newsRows.length ? "live" : "empty",
      previewMode,
      connected: newsResult.status === "fulfilled", publishedCount: newsRows.length,
      guideConnected: guideResult.status === "fulfilled", publishedGuideCount: guideResult.status === "fulfilled" ? guideResult.value.places.length : 0,
      landmarksConnected: landmarksResult.status === "fulfilled", publishedLandmarkCount: landmarkRows.length || fallbackLandmarkData.items?.length || 0,
      error: newsResult.status === "rejected" ? newsResult.reason?.message || "公開記事の取得エラー" : null,
      guideError: guideResult.status === "rejected" ? guideResult.reason?.message || "公開案内図の取得エラー" : null,
      landmarksError: landmarksResult.status === "rejected" ? landmarksResult.reason?.message || "公開目印の取得エラー" : null,
    };
  }).finally(loadApp);
})();
