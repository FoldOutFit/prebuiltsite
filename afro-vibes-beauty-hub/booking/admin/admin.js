/* Afro Vibes Beauty Hub — bookings admin (day / week / month calendar). */
(function () {
  "use strict";
  var API = "https://afro-vibes-booking.wtdaisey.workers.dev";
  var KEY = "avbh-admin-session";
  var DAY_START = 8 * 60, DAY_END = 20 * 60, PX = 1; // grid shows 8 AM–8 PM, 1px per minute
  var cfg, session = sessionStorage.getItem(KEY), view = innerWidth < 760 ? "day" : "week", cursor, data = { bookings: [], blocks: [] }, upcoming = [];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (session) init.headers.Authorization = "Bearer " + session;
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && path !== "/api/admin/login") { signOut(); }
        if (!r.ok) throw new Error(d.error || "Request failed");
        return d;
      });
    });
  }
  function dObj(d) { return new Date(d + "T12:00:00Z"); }
  function addDays(d, n) { var x = dObj(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function dow(d) { return dObj(d).getUTCDay(); }
  function fmtD(d, o) { return dObj(d).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, o)); }
  function mins(t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); }
  function fmtT(t) { var h = +t.slice(0, 2), m = t.slice(3, 5); return (h % 12 || 12) + (m === "00" ? "" : ":" + m) + (h < 12 ? "am" : "pm"); }
  function nowNY() { var p = {}; new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return { date: p.year + "-" + p.month + "-" + p.day, min: (+p.hour % 24) * 60 + +p.minute }; }
  function sIdx(id) { for (var i = 0; i < cfg.stylists.length; i++) if (cfg.stylists[i].id === id) return i; return 0; }
  function sName(id) { return id === "all" ? "Whole salon" : id === "any" ? "Any available" : (cfg.stylists[sIdx(id)] || {}).name || id; }
  function statusLabel(s) { return { booked: "Booked", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" }[s] || s; }

  function signOut() { session = null; sessionStorage.removeItem(KEY); $("#app").hidden = true; $("#login").hidden = false; }
  $("#logout").onclick = signOut;
  $("#login").addEventListener("submit", function (e) {
    e.preventDefault(); var err = $("#login-err"); err.hidden = true;
    api("/api/admin/login", { method: "POST", body: { password: $("#pw").value } }).then(function (d) {
      session = d.session; sessionStorage.setItem(KEY, session); $("#pw").value = ""; start();
    }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
  });

  function range() {
    if (view === "day") return [cursor, cursor];
    if (view === "week") { var s = addDays(cursor, -dow(cursor)); return [s, addDays(s, 6)]; }
    var first = cursor.slice(0, 8) + "01", s2 = addDays(first, -dow(first)); return [s2, addDays(s2, 41)];
  }
  function load() {
    var r = range(), today = nowNY().date;
    $("#cal").innerHTML = '<p class="loading" style="padding:20px"><span class="spinner"></span>Loading…</p>';
    return Promise.all([api("/api/admin/calendar?from=" + r[0] + "&to=" + r[1]), api("/api/admin/calendar?from=" + today + "&to=" + addDays(today, 60))]).then(function (res) {
      data = res[0]; upcoming = res[1].bookings.filter(function (b) { return b.status === "booked"; });
      render();
    }).catch(function (e) { $("#cal").innerHTML = '<p class="alert alert-error" style="margin:16px">' + esc(e.message) + "</p>"; });
  }
  function render() {
    document.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-view") === view); });
    var r = range();
    $("#title").textContent = view === "day" ? fmtD(cursor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : view === "week" ? fmtD(r[0], { month: "short", day: "numeric" }) + " – " + fmtD(r[1], { month: "short", day: "numeric", year: "numeric" })
      : fmtD(cursor, { month: "long", year: "numeric" });
    $("#legend").innerHTML = cfg.stylists.map(function (s, i) { return '<span><i style="background:' + (i ? "#b7792b" : "#9e3b52") + '"></i>' + esc(s.name) + "</span>"; }).join("") +
      '<span><i style="background:#2f7d4a"></i>Completed</span><span><i style="background:#777"></i>No-show</span><span><i style="background:repeating-linear-gradient(45deg,#efe6e3,#efe6e3 3px,#e4d6d2 3px,#e4d6d2 6px)"></i>Blocked</span>';
    if (view === "month") renderMonth(r); else renderGrid(view === "day" ? [cursor] : [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(r[0], i); }));
    renderStats(); renderAgenda();
  }
  function evHtml(b, top, h, left, width) {
    var cls = "ev s" + sIdx(b.stylist.id) + (b.status !== "booked" ? " " + b.status : "");
    return '<button type="button" class="' + cls + '" data-id="' + b.id + '" style="top:' + top + "px;height:" + Math.max(h - 2, 18) + "px;left:" + left + "%;width:calc(" + width + '% - 3px)" aria-label="' + esc(fmtT(b.time) + " " + b.service.name + " with " + b.name + ", " + statusLabel(b.status)) + '"><b>' + esc(b.name) + "</b><span>" + fmtT(b.time) + "–" + fmtT(b.endTime) + " · " + esc(b.service.name) + "</span></button>";
  }
  function renderGrid(days) {
    var n = cfg.stylists.length, single = days.length === 1, now = nowNY();
    var cols = single ? cfg.stylists.map(function (s) { return { date: days[0], sty: s.id, label: s.name }; }) : days.map(function (d) { return { date: d, label: fmtD(d, { weekday: "short", day: "numeric" }) }; });
    var h = '<div class="tg" style="grid-template-columns:52px repeat(' + cols.length + ',minmax(0,1fr))"><div class="tg-colhead" style="border-left:0"></div>';
    cols.forEach(function (c) { h += '<div class="tg-colhead' + (c.date === now.date ? " today" : "") + '">' + (single ? esc(c.label) : '<button type="button" data-day="' + c.date + '">' + esc(c.label) + "</button>") + "</div>"; });
    h += '<div class="tg-times" style="height:' + (DAY_END - DAY_START) * PX + 'px">';
    for (var t = DAY_START + 60; t < DAY_END; t += 60) h += '<span class="tg-time" style="top:' + (t - DAY_START) * PX + 'px">' + fmtT(String(t / 60).padStart(2, "0") + ":00") + "</span>";
    h += "</div>";
    cols.forEach(function (c) {
      var hrs = cfg.hours[dow(c.date)];
      h += '<div class="tg-col' + (hrs ? "" : " closed") + '" style="height:' + (DAY_END - DAY_START) * PX + 'px">';
      if (hrs) { h += '<div style="position:absolute;left:0;right:0;top:0;height:' + (hrs[0] - DAY_START) * PX + 'px;background:rgba(0,0,0,.035)"></div><div style="position:absolute;left:0;right:0;top:' + (hrs[1] - DAY_START) * PX + 'px;bottom:0;background:rgba(0,0,0,.035)"></div>'; }
      data.blocks.filter(function (k) { return k.date === c.date && (!single || k.stylistId === "all" || k.stylistId === c.sty); }).forEach(function (k) {
        var s = Math.max(mins(k.start), DAY_START), e = Math.min(mins(k.end), DAY_END); if (e <= s) return;
        var lane = single || k.stylistId === "all" ? [0, 100] : [sIdx(k.stylistId) * 100 / n, 100 / n];
        h += '<button type="button" class="ev block" data-block="' + k.id + '" style="top:' + (s - DAY_START) * PX + "px;height:" + (e - s) * PX + "px;left:" + lane[0] + "%;width:calc(" + lane[1] + '% - 3px)"><b>Blocked' + (k.reason ? ": " + esc(k.reason) : "") + "</b><span>" + esc(sName(k.stylistId)) + (mins(k.end) - mins(k.start) >= 1440 ? " · all day" : " · " + fmtT(k.start) + "–" + fmtT(k.end)) + "</span></button>";
      });
      data.bookings.filter(function (b) { return b.date === c.date && b.status !== "cancelled" && (!single || b.stylist.id === c.sty); }).forEach(function (b) {
        var s = mins(b.time), e = mins(b.endTime);
        h += single ? evHtml(b, (s - DAY_START) * PX, (e - s) * PX, 0, 100) : evHtml(b, (s - DAY_START) * PX, (e - s) * PX, sIdx(b.stylist.id) * 100 / n, 100 / n);
      });
      if (c.date === now.date && now.min > DAY_START && now.min < DAY_END) h += '<div class="now-line" style="top:' + (now.min - DAY_START) * PX + 'px"></div>';
      h += "</div>";
    });
    $("#cal").innerHTML = h + "</div>";
    bindCal();
  }
  function renderMonth(r) {
    var now = nowNY().date, h = '<div class="mg">' + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(function (d) { return '<div class="mg-dow">' + d + "</div>"; }).join("");
    for (var i = 0; i < 42; i++) {
      var d = addDays(r[0], i), list = data.bookings.filter(function (b) { return b.date === d && b.status !== "cancelled"; }), bl = data.blocks.filter(function (k) { return k.date === d; });
      h += '<button type="button" class="mg-cell' + (d.slice(0, 7) !== cursor.slice(0, 7) ? " other" : "") + (d === now ? " today" : "") + (cfg.hours[dow(d)] ? "" : " closed") + '" data-day="' + d + '" aria-label="' + esc(fmtD(d, { weekday: "long", month: "long", day: "numeric" }) + ": " + list.length + " bookings") + '"><span class="mg-num">' + +d.slice(8) + "</span>";
      if (bl.length) h += '<span class="mg-chip" style="background:#cbb8b3;color:#3a2a2e">Blocked' + (bl[0].reason ? ": " + esc(bl[0].reason) : "") + "</span>";
      list.slice(0, 3).forEach(function (b) { h += '<span class="mg-chip" style="background:' + (b.status === "completed" ? "#2f7d4a" : b.status === "no_show" ? "#777" : sIdx(b.stylist.id) ? "#b7792b" : "#9e3b52") + '">' + fmtT(b.time) + " " + esc(b.name) + "</span>"; });
      if (list.length > 3) h += '<span class="mg-more">+' + (list.length - 3) + " more</span>";
      h += "</button>";
    }
    $("#cal").innerHTML = h + "</div>";
    bindCal();
  }
  function bindCal() {
    $("#cal").querySelectorAll("[data-day]").forEach(function (b) { b.onclick = function () { cursor = b.getAttribute("data-day"); view = "day"; load(); }; });
    $("#cal").querySelectorAll("[data-id]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openBooking(b.getAttribute("data-id")); }; });
    $("#cal").querySelectorAll("[data-block]").forEach(function (b) { b.onclick = function () { openBlock(b.getAttribute("data-block")); }; });
  }
  function renderStats() {
    var now = nowNY(), today = upcoming.filter(function (b) { return b.date === now.date; }), wkEnd = addDays(now.date, 6);
    var week = upcoming.filter(function (b) { return b.date <= wkEnd; });
    var value = week.reduce(function (a, b) { return a + b.service.price; }, 0);
    var next = upcoming.filter(function (b) { return b.date > now.date || mins(b.time) >= now.min; })[0];
    $("#stats").innerHTML = '<div class="stat"><b>' + today.length + '</b><span>Appointments today</span></div><div class="stat"><b>' + week.length + '</b><span>Next 7 days</span></div><div class="stat"><b>$' + value + '</b><span>Booked value, next 7 days (from)</span></div><div class="stat"><b>' + (next ? fmtT(next.time) : "—") + "</b><span>" + (next ? "Next: " + esc(next.name) + (next.date !== now.date ? ", " + fmtD(next.date, { month: "short", day: "numeric" }) : "") : "No upcoming bookings") + "</span></div>";
  }
  function renderAgenda() {
    var list = upcoming.slice(0, 25);
    $("#agenda").innerHTML = list.length ? list.map(function (b) {
      return '<button type="button" class="ag-item" data-id="' + b.id + '"><span class="ag-when">' + esc(fmtD(b.date, { weekday: "short", month: "short", day: "numeric" })) + "<small>" + fmtT(b.time) + "–" + fmtT(b.endTime) + '</small></span><span class="ag-main"><strong>' + esc(b.name) + "</strong><small>" + esc(b.service.name) + " · " + esc(b.stylist.name) + " · " + esc(b.phone) + '</small></span><span class="status-pill">' + esc(b.id) + "</span></button>";
    }).join("") : '<p class="hint">No upcoming appointments yet. New online bookings show up here and in your calendar feed instantly.</p>';
    $("#agenda").querySelectorAll("[data-id]").forEach(function (b) { b.onclick = function () { openBooking(b.getAttribute("data-id")); }; });
  }

  function find(id) { return data.bookings.concat(upcoming).filter(function (b) { return b.id === id; })[0]; }
  function openBooking(id) {
    var b = find(id); if (!b) return;
    var d = $("#dlg-booking");
    var btn = function (st, label, cls) { return b.status === st ? "" : '<button type="button" class="btn ' + (cls || "btn-outline") + ' btn-sm" data-st="' + st + '">' + label + "</button>"; };
    $("#db-body").innerHTML = '<button class="x" type="button" data-close aria-label="Close">×</button><p class="section-label">' + esc(b.id) + ' · <span class="status-pill ' + b.status + '">' + statusLabel(b.status) + '</span></p><h2 id="db-title">' + esc(b.name) + "</h2>" +
      '<dl class="dl"><dt>When</dt><dd>' + esc(fmtD(b.date, { weekday: "long", month: "long", day: "numeric" })) + ", " + fmtT(b.time) + "–" + fmtT(b.endTime) + "</dd><dt>Service</dt><dd>" + esc(b.service.name) + " (from $" + b.service.price + ")</dd><dt>Stylist</dt><dd>" + esc(b.stylist.name) + (b.stylistPref === "any" ? " (client chose any)" : "") + "</dd>" +
      "<dt>Phone</dt><dd>" + (b.phone ? '<a href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">' + esc(b.phone) + "</a>" : "—") + "</dd><dt>Email</dt><dd>" + (b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + "</a>" : "—") + "</dd><dt>Notes</dt><dd>" + (esc(b.notes) || "—") + "</dd><dt>Booked</dt><dd>" + (b.source === "salon" ? "By salon" : "Online") + ", " + esc(new Date(b.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })) + "</dd></dl>" +
      '<div class="actions">' + btn("completed", "Mark completed", "btn-primary") + btn("no_show", "No-show") + btn("cancelled", "Cancel booking", "btn-danger") + btn("booked", "Restore to booked") + '</div><p class="alert alert-error" id="db-err" role="alert" hidden></p><p class="hint" style="margin-top:14px"><button type="button" class="step-edit" data-del>Delete permanently</button></p>';
    d.querySelectorAll("[data-st]").forEach(function (x) {
      x.onclick = function () {
        x.disabled = true;
        api("/api/admin/bookings/" + b.id, { method: "POST", body: { status: x.getAttribute("data-st") } }).then(function () { d.close(); load(); })
          .catch(function (e) { var er = $("#db-err"); er.textContent = e.message; er.hidden = false; x.disabled = false; });
      };
    });
    d.querySelector("[data-del]").onclick = function () { if (confirm("Permanently delete booking " + b.id + "? This can't be undone.")) api("/api/admin/bookings/" + b.id, { method: "DELETE" }).then(function () { d.close(); load(); }); };
    d.querySelector("[data-close]").onclick = function () { d.close(); };
    d.showModal();
  }
  function openBlock(id) {
    var k = data.blocks.filter(function (x) { return x.id === id; })[0]; if (!k) return;
    if (confirm("Remove this blocked time (" + sName(k.stylistId) + ", " + fmtD(k.date, { month: "short", day: "numeric" }) + (k.reason ? ", " + k.reason : "") + ")? The time becomes bookable again.")) api("/api/admin/blocks/" + id, { method: "DELETE" }).then(load);
  }

  function initDialogs() {
    document.querySelectorAll("dialog [data-close]").forEach(function (b) { b.onclick = function () { b.closest("dialog").close(); }; });
    var stOpts = cfg.stylists.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + "</option>"; }).join("");
    $("#bl-sty").innerHTML = '<option value="all">Whole salon (everyone)</option>' + stOpts;
    $("#nb-sty").innerHTML = '<option value="any">Any available</option>' + stOpts;
    $("#nb-svc").innerHTML = cfg.categories.map(function (c) { return '<optgroup label="' + esc(c.category) + '">' + c.services.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + " · " + s.duration + " min · from $" + s.price + "</option>"; }).join("") + "</optgroup>"; }).join("");
    var syncAll = function () { document.querySelectorAll(".bl-times").forEach(function (x) { x.hidden = $("#bl-all").checked; }); };
    $("#bl-all").onchange = syncAll;
    $("#new-block").onclick = function () { $("#bl-date").value = cursor; $("#bl-err").hidden = true; syncAll(); $("#dlg-block").showModal(); };
    $("#block-form").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/admin/blocks", { method: "POST", body: { date: $("#bl-date").value, days: +$("#bl-days").value || 1, allDay: $("#bl-all").checked, start: $("#bl-start").value, end: $("#bl-end").value, stylist: $("#bl-sty").value, reason: $("#bl-reason").value } })
        .then(function (d) { $("#dlg-block").close(); $("#bl-reason").value = ""; if (d.overlappingBookings) alert("Time blocked. Note: " + d.overlappingBookings + " existing booking(s) overlap this time — contact those clients if needed."); load(); })
        .catch(function (x) { $("#bl-err").textContent = x.message; $("#bl-err").hidden = false; });
    });
    $("#new-booking").onclick = function () { $("#nb-date").value = cursor; $("#nb-err").hidden = true; $("#dlg-new").showModal(); };
    $("#new-form").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/admin/bookings", { method: "POST", body: { service: $("#nb-svc").value, stylist: $("#nb-sty").value, date: $("#nb-date").value, time: $("#nb-time").value, name: $("#nb-name").value, phone: $("#nb-phone").value, email: $("#nb-email").value, notes: $("#nb-notes").value } })
        .then(function (d) { $("#dlg-new").close(); $("#new-form").reset(); cursor = d.booking.date; load(); })
        .catch(function (x) { $("#nb-err").textContent = x.message; $("#nb-err").hidden = false; });
    });
    $("#feed-btn").onclick = function () {
      api("/api/admin/feed").then(function (d) {
        $("#feed-url").value = d.url; $("#feed-webcal").href = d.url.replace(/^https?:/, "webcal:"); $("#dlg-feed").showModal();
      });
    };
    $("#feed-copy").onclick = function (e) { $("#feed-url").select(); navigator.clipboard.writeText($("#feed-url").value).then(function () { e.target.textContent = "Copied"; }); };
  }

  function step(n) {
    if (view === "day") cursor = addDays(cursor, n);
    else if (view === "week") cursor = addDays(cursor, 7 * n);
    else { var p = cursor.split("-").map(Number); cursor = new Date(Date.UTC(p[0], p[1] - 1 + n, 1, 12)).toISOString().slice(0, 10); }
    load();
  }
  $("#prev").onclick = function () { step(-1); };
  $("#next").onclick = function () { step(1); };
  $("#today").onclick = function () { cursor = nowNY().date; load(); };
  document.querySelectorAll(".seg button").forEach(function (b) { b.onclick = function () { view = b.getAttribute("data-view"); load(); }; });

  var started = false;
  function start() {
    $("#login").hidden = true; $("#app").hidden = false;
    if (!started) { started = true; initDialogs(); }
    cursor = cursor || nowNY().date; load();
  }
  fetch(API + "/api/config").then(function (r) { return r.json(); }).then(function (c) {
    cfg = c;
    if (session) start(); else { $("#login").hidden = false; $("#pw").focus(); }
  }).catch(function () { $("#login").hidden = false; });
})();
