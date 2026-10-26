/*
 * Follow my trip (Spotplanner ADR 0024): draws the trip a traveller shared by link.
 * GET <api>/api/public/trips/<token> → { snapshot: TripSnapshot, photos: { blogPhotoId: signedUrl } }.
 * Everything the traveller wrote is put on the page as text (textContent), never as HTML.
 */
(function () {
  "use strict";

  var DEFAULT_API = "https://api.spotplanner.eu";
  var STYLE = "https://tiles.openfreemap.org/styles/positron";
  /** One colour per day when every day is on the map at once; day 1 is the app's teal. */
  var DAY_COLORS = ["#0B8583", "#E08A1E", "#6E5FD0", "#D23F3F", "#2F80ED", "#1F9D55", "#B5547F"];
  /** A follow page stays open while the trip goes on: look for a newer snapshot this often. */
  var REFRESH_MS = 5 * 60 * 1000;

  var params = new URLSearchParams(location.search);
  var token = (params.get("t") || "").trim();
  var demo = params.get("demo") === "1";
  var api = apiBase(params.get("api"));

  var state = { data: null, selected: "all", map: null, mapReady: false, markers: [], loadedAt: 0, focus: null };
  var $ = function (id) { return document.getElementById(id); };

  /** `?api=` is for testing against a local backend only, so a crafted link cannot put someone else's content on this page. */
  function apiBase(value) {
    if (!value) return DEFAULT_API;
    try {
      var u = new URL(value);
      var h = u.hostname;
      var local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /\.localhost$/.test(h);
      if (local && (u.protocol === "http:" || u.protocol === "https:")) return u.origin;
    } catch (e) { /* fall through */ }
    return DEFAULT_API;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function show(which) {
    ["loading", "gone", "failed", "trip"].forEach(function (id) { $(id).hidden = id !== which; });
  }

  function safeImageUrl(url) {
    if (typeof url !== "string") return null;
    if (/^https:\/\/[^\s"'<>\\]+$/.test(url)) return url;
    if (api !== DEFAULT_API && /^http:\/\/[^\s"'<>\\]+$/.test(url)) return url; // a local backend's filesystem storage
    return null;
  }

  // ---------- dates ----------

  function parseDay(iso) {
    var m = typeof iso === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmt(options) {
    try { return new Intl.DateTimeFormat(undefined, options); } catch (e) { return new Intl.DateTimeFormat("en", options); }
  }

  function dateRange(from, to) {
    var a = parseDay(from), b = parseDay(to);
    if (!a) return "";
    var f = fmt({ day: "numeric", month: "short", year: "numeric" });
    if (!b || b.getTime() === a.getTime()) return f.format(a);
    return typeof f.formatRange === "function" ? f.formatRange(a, b) : f.format(a) + " – " + f.format(b);
  }

  function ago(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return "";
    var minutes = Math.round((Date.now() - t) / 60000);
    if (minutes < 0) return "";
    try {
      var r = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      if (minutes < 60) return r.format(-minutes, "minute");
      if (minutes < 48 * 60) return r.format(-Math.round(minutes / 60), "hour");
      return r.format(-Math.round(minutes / 1440), "day");
    } catch (e) {
      return "";
    }
  }

  function flag(code) {
    if (typeof code !== "string" || !/^[A-Z]{2}$/.test(code)) return "";
    return String.fromCodePoint(0x1f1e6 + code.charCodeAt(0) - 65, 0x1f1e6 + code.charCodeAt(1) - 65);
  }

  // ---------- loading ----------

  function load(quiet) {
    if (demo) return Promise.resolve(render(DEMO));
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) {
      show("gone");
      return Promise.resolve();
    }
    if (!quiet) show("loading");
    return fetch(api + "/api/public/trips/" + encodeURIComponent(token), { credentials: "omit", headers: { Accept: "application/json" } })
      .then(function (res) {
        if (res.status === 404) {
          state.data = null;
          show("gone");
          return;
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json().then(function (body) {
          if (!body || !body.snapshot || !Array.isArray(body.snapshot.days)) throw new Error("Unexpected answer");
          render(body);
        });
      })
      .catch(function () {
        if (!quiet || !state.data) show("failed");
      });
  }

  // ---------- page ----------

  function render(body) {
    var s = body.snapshot;
    // A fresh signed URL every refresh made the browser fetch every photo again: keep the one it has while it lasts.
    var signed = body.photos || {};
    var kept = state.photoUrls || {};
    var now = Date.now();
    var next = {};
    var photos = {};
    Object.keys(signed).forEach(function (id) {
      next[id] = kept[id] && now - kept[id].at < 55 * 60 * 1000 ? kept[id] : { url: signed[id], at: now };
      photos[id] = next[id].url;
    });
    state.photoUrls = next;
    state.data = { snapshot: s, photos: photos };
    state.loadedAt = Date.now();
    var days = s.days || [];

    document.title = (s.title || "A trip") + " · Spotplanner";
    $("title").textContent = s.title || s.destination || "A trip";

    var meta = $("meta");
    meta.textContent = "";
    if (s.destination) meta.appendChild(el("span", null, (flag(s.countryCode) + " " + s.destination).trim()));
    var range = dateRange(s.from, s.to);
    if (range) meta.appendChild(el("span", null, range));
    meta.appendChild(el("span", null, days.length === 1 ? "1 day" : days.length + " days"));
    if (s.by) meta.appendChild(el("span", null, "by " + s.by));
    var updated = ago(s.updatedAt);
    $("updated").textContent = updated ? "Updated " + updated : "";

    // Default view: today's day while the trip is under way, otherwise what the reader had picked.
    var today = todayIso();
    var todayIndex = days.findIndex(function (d) { return d.date === today; });
    if (state.selected !== "all" && state.selected >= days.length) state.selected = "all";
    if (!state.loadedOnce && todayIndex >= 0) state.selected = todayIndex;
    state.loadedOnce = true;

    renderChips(days);
    renderDays(days, photos, todayIndex);
    show("trip");
    drawMap();
  }

  function renderChips(days) {
    var chips = $("chips");
    chips.textContent = "";
    var all = el("button", "chip", "All days");
    all.type = "button";
    all.setAttribute("aria-pressed", String(state.selected === "all"));
    all.addEventListener("click", function () { select("all", true); });
    chips.appendChild(all);
    days.forEach(function (day, i) {
      var b = el("button", "chip", "Day " + (i + 1));
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.selected === i));
      b.addEventListener("click", function () { select(i, true); });
      chips.appendChild(b);
    });
    if (days.length < 2) chips.hidden = true;
    else chips.hidden = false;
  }

  /** A day keeps its colour everywhere (chip view, all-days view, the list), so pins and rows match. */
  function dayColor(i) {
    return DAY_COLORS[i % DAY_COLORS.length];
  }

  function renderDays(days, photos, todayIndex) {
    var root = $("days");
    root.textContent = "";
    var dayFmt = fmt({ weekday: "long", day: "numeric", month: "long" });
    days.forEach(function (day, i) {
      var section = el("section", "day");
      section.id = "day-" + (i + 1);
      var head = el("div", "day-head");
      head.appendChild(el("h2", null, "Day " + (i + 1)));
      var date = parseDay(day.date);
      if (date) head.appendChild(el("span", "date", dayFmt.format(date)));
      if (i === todayIndex) head.appendChild(el("span", "today", "Today"));
      section.appendChild(head);
      if (day.title) section.appendChild(el("p", "day-title", day.title));

      var entry = day.entry || {};
      var shots = (entry.photoIds || []).map(function (id) { return safeImageUrl(photos[id]); }).filter(Boolean);
      if (entry.text || shots.length) {
        var box = el("div", "entry");
        if (entry.text) box.appendChild(el("p", null, entry.text));
        if (shots.length) {
          var grid = el("div", "shots");
          shots.forEach(function (url, n) {
            var b = el("button", "shot");
            b.type = "button";
            b.setAttribute("aria-label", "Open photo " + (n + 1) + " of day " + (i + 1));
            var img = el("img");
            img.loading = "lazy";
            img.decoding = "async";
            img.alt = "";
            img.src = url;
            img.addEventListener("error", function () { b.hidden = true; });
            b.appendChild(img);
            b.addEventListener("click", function () { openPhoto(url); });
            grid.appendChild(b);
          });
          box.appendChild(grid);
        }
        section.appendChild(box);
      }

      var stops = day.stops || [];
      if (!stops.length) {
        if (!entry.text && !shots.length) section.appendChild(el("p", "empty-day", "A free day."));
      } else {
        var list = el("ol", "stops");
        stops.forEach(function (stop, n) {
          var li = el("li", "stop");
          li.tabIndex = 0;
          li.dataset.key = i + ":" + n;
          var num = el("span", "num", String(n + 1));
          num.style.background = dayColor(i);
          li.appendChild(num);
          var text = el("div");
          var time = [stop.start, stop.end].filter(Boolean).join(" – ");
          if (time) text.appendChild(el("div", "time", time));
          text.appendChild(el("div", "name", stop.name || "A stop"));
          if (stop.category && stop.category !== "other") text.appendChild(el("div", "cat", stop.category));
          li.appendChild(text);
          var pic = safeImageUrl(stop.photoUrl);
          if (pic) {
            var img = el("img", "thumb");
            img.loading = "lazy";
            img.decoding = "async";
            img.alt = "";
            img.src = pic;
            img.addEventListener("error", function () { img.style.visibility = "hidden"; });
            li.appendChild(img);
          } else {
            li.appendChild(el("span"));
          }
          var go = function () { focusStop(i, n, true); };
          li.addEventListener("click", go);
          li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
          list.appendChild(li);
        });
        section.appendChild(list);
      }
      root.appendChild(section);
    });
  }

  function select(which, scroll) {
    state.selected = which;
    state.focus = null;
    Array.prototype.forEach.call($("chips").children, function (chip, k) {
      chip.setAttribute("aria-pressed", String(k === 0 ? which === "all" : which === k - 1));
    });
    drawMap();
    if (!scroll) return;
    var target = which === "all" ? $("days") : $("day-" + (which + 1));
    if (target) target.scrollIntoView({ behavior: smooth(), block: "start" });
  }

  function smooth() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  // ---------- map ----------

  function visibleDays() {
    var days = (state.data && state.data.snapshot.days) || [];
    return days
      .map(function (day, i) { return { day: day, i: i }; })
      .filter(function (d) { return state.selected === "all" || d.i === state.selected; });
  }

  function validStop(s) {
    return s && typeof s.lat === "number" && typeof s.lng === "number" && isFinite(s.lat) && isFinite(s.lng);
  }

  function drawMap() {
    if (typeof maplibregl === "undefined") {
      document.querySelector(".mapwrap").hidden = true; // the map library did not load: the list still tells the trip
      return;
    }
    if (!state.map) {
      state.map = new maplibregl.Map({
        container: "map",
        style: STYLE,
        attributionControl: { compact: true },
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
        center: [0, 20],
        zoom: 1,
      });
      state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      state.map.on("load", function () {
        state.mapReady = true;
        // The credits stay one tap away (the ⓘ) and are also in the footer; open, they cover the route on a phone.
        var attrib = state.map.getContainer().querySelector(".maplibregl-ctrl-attrib");
        if (attrib) attrib.classList.remove("maplibregl-compact-show");
        state.map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        state.map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.9 } });
        state.map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4 } });
        drawMap();
      });
      return;
    }
    if (!state.mapReady) return;

    var features = [];
    var bounds = new maplibregl.LngLatBounds();
    state.markers.forEach(function (m) { m.marker.remove(); });
    state.markers = [];

    visibleDays().forEach(function (d) {
      var color = dayColor(d.i);
      var coords = [];
      (d.day.stops || []).forEach(function (stop, n) {
        if (!validStop(stop)) return;
        var at = [stop.lng, stop.lat];
        coords.push(at);
        bounds.extend(at);
        var pin = el("div", "pin", String(n + 1));
        pin.style.background = color;
        pin.setAttribute("role", "button");
        pin.setAttribute("aria-label", "Day " + (d.i + 1) + ", stop " + (n + 1) + ": " + (stop.name || ""));
        pin.title = stop.name || "";
        pin.addEventListener("click", function (e) {
          e.stopPropagation();
          focusStop(d.i, n, false);
          var row = document.querySelector('.stop[data-key="' + d.i + ":" + n + '"]');
          if (row) row.scrollIntoView({ behavior: smooth(), block: "center" });
        });
        var marker = new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat(at).addTo(state.map);
        state.markers.push({ key: d.i + ":" + n, marker: marker, el: pin });
      });
      if (coords.length > 1) features.push({ type: "Feature", properties: { color: color }, geometry: { type: "LineString", coordinates: coords } });
    });

    state.map.getSource("route").setData({ type: "FeatureCollection", features: features });
    if (!bounds.isEmpty()) {
      var pad = window.innerWidth < 600 ? 40 : 64;
      state.map.fitBounds(bounds, { padding: pad, maxZoom: 15, duration: state.fitted ? 600 : 0 });
      state.fitted = true;
    }
    markFocus();
  }

  function focusStop(dayIndex, stopIndex, fromList) {
    if (state.selected !== "all" && state.selected !== dayIndex) select(dayIndex, false);
    state.focus = dayIndex + ":" + stopIndex;
    markFocus();
    var stop = state.data.snapshot.days[dayIndex].stops[stopIndex];
    if (state.map && state.mapReady && validStop(stop)) {
      state.map.easeTo({ center: [stop.lng, stop.lat], zoom: Math.max(state.map.getZoom(), 15), duration: smooth() === "auto" ? 0 : 600 });
      if (fromList && window.innerWidth < 900) document.querySelector(".mapwrap").scrollIntoView({ behavior: smooth(), block: "center" });
    }
  }

  function markFocus() {
    state.markers.forEach(function (m) { m.el.classList.toggle("is-focus", m.key === state.focus); });
    Array.prototype.forEach.call(document.querySelectorAll(".stop"), function (row) {
      row.classList.toggle("is-focus", row.dataset.key === state.focus);
    });
  }

  // ---------- photos ----------

  function openPhoto(url) {
    $("lightbox-img").src = url;
    $("lightbox").classList.add("open");
    $("lightbox-close").focus();
  }

  function closePhoto() {
    $("lightbox").classList.remove("open");
    $("lightbox-img").removeAttribute("src");
  }

  $("lightbox").addEventListener("click", closePhoto);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePhoto(); });
  $("retry").addEventListener("click", function () { load(false); });

  // Keep a long-open page current (new days, new photos, fresh photo links), but only while it is looked at.
  function maybeRefresh() {
    if (demo || document.visibilityState !== "visible" || !state.data) return;
    if (Date.now() - state.loadedAt >= REFRESH_MS) load(true);
  }
  document.addEventListener("visibilitychange", maybeRefresh);
  setInterval(maybeRefresh, 60 * 1000);

  // ---------- demo (?demo=1) ----------

  var W = "https://thumb.wikimedia.org/wikipedia/commons/thumb/";
  var DEMO = {
    snapshot: {
      v: 1,
      title: "Three days in Lisbon",
      destination: "Lisbon",
      countryCode: "PT",
      from: "2026-04-01",
      to: "2026-04-03",
      by: "Ana",
      updatedAt: new Date(Date.now() - 42 * 60000).toISOString(),
      days: [
        {
          date: "2026-04-01",
          title: "Belém and the river",
          stops: [
            { name: "Jerónimos Monastery", start: "09:30", end: "11:00", lat: 38.6979, lng: -9.2065, category: "monument", photoUrl: W + "0/0e/1502_legte_K%C3%B6nig_Manuel_I._den_Grundstein_f%C3%BCr_das_Hieronymus_Kloster_in_Lissabon._06.jpg/500px-1502_legte_K%C3%B6nig_Manuel_I._den_Grundstein_f%C3%BCr_das_Hieronymus_Kloster_in_Lissabon._06.jpg" },
            { name: "Pastéis de Belém", start: "11:10", end: "11:40", lat: 38.6975, lng: -9.2033, category: "cafe", photoUrl: W + "5/5a/Pasteis_de_nata_%28Lissabon_2016%29_%2826069956686%29.jpg/500px-Pasteis_de_nata_%28Lissabon_2016%29_%2826069956686%29.jpg" },
            { name: "Belém Tower", start: "12:00", end: "12:45", lat: 38.6916, lng: -9.216, category: "monument", photoUrl: W + "b/b5/Belem_Tower_-_April_2019_%282%29.jpg/500px-Belem_Tower_-_April_2019_%282%29.jpg" },
            { name: "MAAT", start: "14:00", end: "15:30", lat: 38.6959, lng: -9.1938, category: "museum", photoUrl: W + "4/4c/The_MAAT_%2834943440096%29.jpg/500px-The_MAAT_%2834943440096%29.jpg" },
            { name: "LX Factory", start: "16:00", end: "17:30", lat: 38.7036, lng: -9.1786, category: "market", photoUrl: W + "5/54/LX_Factory_%2822379332901%29.jpg/500px-LX_Factory_%2822379332901%29.jpg" },
          ],
          entry: {
            text: "We started with the monastery before the queues. The pastéis were still warm — we had two each.\n\nThe tower is smaller than you expect, the light on the river is not.",
            photoIds: ["demo-1", "demo-2"],
          },
        },
        {
          date: "2026-04-02",
          title: "Baixa, Chiado and the castle",
          stops: [
            { name: "Praça do Comércio", start: "09:30", end: "10:15", lat: 38.7077, lng: -9.1366, category: "landmark", photoUrl: W + "1/18/Aerial_view_of_Pra%C3%A7a_do_Com%C3%A9rcio_and_Baixa_Pombalina_%28cropped_and_retouched%29.jpg/500px-Aerial_view_of_Pra%C3%A7a_do_Com%C3%A9rcio_and_Baixa_Pombalina_%28cropped_and_retouched%29.jpg" },
            { name: "Santa Justa Lift", start: "10:30", end: "11:00", lat: 38.7122, lng: -9.1394, category: "landmark" },
            { name: "Carmo Convent", start: "11:10", end: "12:00", lat: 38.7121, lng: -9.1405, category: "monument", photoUrl: W + "1/13/Lissabon_-_Convento_do_Carmo_from_Castle.jpg/500px-Lissabon_-_Convento_do_Carmo_from_Castle.jpg" },
            { name: "Castelo de São Jorge", start: "14:30", end: "16:00", lat: 38.7139, lng: -9.1335, category: "monument", photoUrl: W + "1/17/Castelo_de_S%C3%A3o_Jorge_%2810251035013%29.jpg/500px-Castelo_de_S%C3%A3o_Jorge_%2810251035013%29.jpg" },
            { name: "Miradouro de Santa Luzia", start: "16:20", end: "17:00", lat: 38.7118, lng: -9.1302, category: "viewpoint", photoUrl: W + "b/b3/MiradouroSantaLuzia.JPG/500px-MiradouroSantaLuzia.JPG" },
          ],
          entry: { text: "Tram 28 was full, so we walked up. Worth it for the view at Santa Luzia." },
        },
        { date: "2026-04-03", stops: [] },
      ],
    },
    photos: {
      "demo-1": W + "b/b5/Belem_Tower_-_April_2019_%282%29.jpg/1280px-Belem_Tower_-_April_2019_%282%29.jpg",
      "demo-2": W + "5/5a/Pasteis_de_nata_%28Lissabon_2016%29_%2826069956686%29.jpg/500px-Pasteis_de_nata_%28Lissabon_2016%29_%2826069956686%29.jpg",
    },
  };

  load(false);
})();
