/* Afro Vibes Beauty Hub — online booking client. Talks to the Cloudflare Worker API. */
(function () {
  "use strict";
  var API = "https://afro-vibes-booking.wtdaisey.workers.dev";
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
  var MANAGE_URL = new URL("manage/", SCRIPT_URL).href;
  var BOOK_URL = new URL("./", SCRIPT_URL).href;
  var STORE_KEY = "avbh-bookings";
  var cfg = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Something went wrong. Please try again."); e.status = r.status; throw e; }
        return d;
      });
    }, function () { throw new Error("Can't reach the booking system. Check your connection or call (215) 558-9643."); });
  }
  function fmtTime(t) { var p = t.split(":"), h = +p[0], m = p[1]; return (h % 12 || 12) + ":" + m + " " + (h < 12 ? "AM" : "PM"); }
  function dateObj(d) { return new Date(d + "T12:00:00Z"); }
  function fmtDate(d, long) { return dateObj(d).toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric" }); }
  function addDays(d, n) { var x = dateObj(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function fmtDur(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + " hr" : "") + (h && r ? " " : "") + (r ? r + " min" : ""); }
  function money(n) { return "$" + n; }
  function findService(id) { var out = null; (cfg.categories || []).forEach(function (c) { c.services.forEach(function (s) { if (s.id === id) out = Object.assign({ category: c.category }, s); }); }); return out; }
  function stylistName(id) { if (id === "any") return "Any available"; var s = cfg.stylists.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function isOpen(d) { return !!cfg.hours[dateObj(d).getUTCDay()]; }
  function utcStamp(iso) { return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function googleUrl(b) {
    var q = new URLSearchParams({ action: "TEMPLATE", text: b.service.name + " at Afro Vibes Beauty Hub", dates: utcStamp(b.startUtc) + "/" + utcStamp(b.endUtc),
      details: "Booking ref " + b.id + "\nStylist: " + b.stylist.name + "\nManage: " + manageLink(b) + "\nSalon: " + cfg.salon.phone, location: cfg.salon.address, ctz: cfg.salon.timezone });
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  var tokens = {};
  function manageLink(b) { return MANAGE_URL + "?id=" + encodeURIComponent(b.id) + "&t=" + encodeURIComponent(tokens[b.id] || ""); }
  function icsEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
  function downloadIcs(b) {
    var ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Afro Vibes Beauty Hub//Booking//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + b.id + "@afro-vibes-booking", "DTSTAMP:" + utcStamp(new Date().toISOString()), "DTSTART:" + utcStamp(b.startUtc), "DTEND:" + utcStamp(b.endUtc),
      "SUMMARY:" + icsEsc(b.service.name + " at Afro Vibes Beauty Hub"),
      "DESCRIPTION:" + icsEsc("Booking ref " + b.id + "\nStylist: " + b.stylist.name + "\nManage or cancel: " + manageLink(b) + "\nQuestions? Call " + cfg.salon.phone),
      "LOCATION:" + icsEsc(cfg.salon.address), "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Hair appointment in 2 hours", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "afro-vibes-" + b.id + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function remember(b, t) {
    try { var all = JSON.parse(localStorage.getItem(STORE_KEY) || "[]").filter(function (x) { return x.id !== b.id; }); all.unshift({ id: b.id, t: t, date: b.date, time: b.time, service: b.service.name }); localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(0, 5))); } catch (e) {}
  }
  function bookingRows(b) {
    return '<ul class="sum-list">' +
      "<li><span>Service</span><span>" + esc(b.service.name) + "</span></li>" +
      "<li><span>Date</span><span>" + esc(fmtDate(b.date, true)) + "</span></li>" +
      "<li><span>Time</span><span>" + fmtTime(b.time) + " – " + fmtTime(b.endTime) + "</span></li>" +
      "<li><span>Stylist</span><span>" + esc(b.stylist.name) + "</span></li>" +
      "<li><span>Starting price</span><span>" + money(b.service.price) + "</span></li>" +
      "<li><span>Name</span><span>" + esc(b.name) + "</span></li></ul>";
  }
  function calActions(b) {
    return '<div class="actions"><a class="btn btn-primary" target="_blank" rel="noopener" href="' + esc(googleUrl(b)) + '">Add to Google Calendar</a>' +
      '<button type="button" class="btn btn-outline" data-ics>Download .ics (Apple / Outlook)</button></div>';
  }

  /* ---------- date + time picker (shared by booking and reschedule) ---------- */
  function Picker(root, opts) {
    var self = this;
    this.root = root; this.opts = opts; this.date = null; this.time = null;
    var first = cfg.today; this.min = first; this.max = addDays(first, cfg.maxDays);
    this.month = first.slice(0, 7);
    root.innerHTML = '<div class="dt-grid"><div class="cal" aria-label="Choose a date"><div class="cal-head"><button type="button" class="icon-btn" data-prev aria-label="Previous month">‹</button><strong aria-live="polite"></strong><button type="button" class="icon-btn" data-next aria-label="Next month">›</button></div><div class="cal-grid" role="group"></div></div><div class="slots-wrap" aria-live="polite"><p class="hint">Pick a date to see open times. Closed Mondays.</p></div></div>';
    root.querySelector("[data-prev]").onclick = function () { self.shift(-1); };
    root.querySelector("[data-next]").onclick = function () { self.shift(1); };
    this.renderMonth();
  }
  Picker.prototype.shift = function (n) { var p = this.month.split("-").map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)); this.month = d.toISOString().slice(0, 7); this.renderMonth(); };
  Picker.prototype.renderMonth = function () {
    var self = this, p = this.month.split("-").map(Number);
    var first = new Date(Date.UTC(p[0], p[1] - 1, 1)), days = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    this.root.querySelector(".cal-head strong").textContent = first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
    this.root.querySelector("[data-prev]").disabled = this.month <= this.min.slice(0, 7);
    this.root.querySelector("[data-next]").disabled = this.month >= this.max.slice(0, 7);
    var h = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(function (d) { return '<span class="cal-dow" aria-hidden="true">' + d + "</span>"; }).join("");
    for (var i = 0; i < first.getUTCDay(); i++) h += "<span></span>";
    for (var d = 1; d <= days; d++) {
      var ds = this.month + "-" + String(d).padStart(2, "0");
      var ok = ds >= this.min && ds <= this.max && isOpen(ds);
      h += '<button type="button" class="day' + (ds === cfg.today ? " today" : "") + '" data-date="' + ds + '"' + (ok ? "" : " disabled") + ' aria-pressed="' + (ds === this.date) + '" aria-label="' + esc(fmtDate(ds, true)) + (ok ? "" : isOpen(ds) ? ", unavailable" : ", closed") + '">' + d + "</button>";
    }
    var g = this.root.querySelector(".cal-grid"); g.innerHTML = h;
    g.querySelectorAll(".day:not([disabled])").forEach(function (b) { b.onclick = function () { self.pickDate(b.getAttribute("data-date")); }; });
  };
  Picker.prototype.pickDate = function (ds) {
    var self = this; this.date = ds; this.time = null; this.renderMonth(); this.opts.onChange && this.opts.onChange();
    var w = this.root.querySelector(".slots-wrap");
    w.innerHTML = '<p class="loading"><span class="spinner"></span>Finding open times for ' + esc(fmtDate(ds, true)) + "…</p>";
    var q = "/api/availability?date=" + ds + "&service=" + encodeURIComponent(this.opts.service()) + "&stylist=" + encodeURIComponent(this.opts.stylist()) + (this.opts.exclude ? this.opts.exclude() : "");
    api(q).then(function (d) {
      if (self.date !== ds) return;
      var free = d.slots.filter(function (s) { return s.available; });
      if (!d.slots.length || !free.length) {
        w.innerHTML = "<p class=\"hint\"><strong>No open times on " + esc(fmtDate(ds, true)) + ".</strong> Try another day" + (self.opts.stylist() !== "any" ? " or choose “Any available”" : "") + ".</p>"; return;
      }
      var groups = [["Morning", 0, 720], ["Afternoon", 720, 1020], ["Evening", 1020, 1440]], html = '<h4 class="sr-only">Available times for ' + esc(fmtDate(ds, true)) + "</h4>";
      groups.forEach(function (g) {
        var list = d.slots.filter(function (s) { var m = +s.time.slice(0, 2) * 60 + +s.time.slice(3); return m >= g[1] && m < g[2]; });
        if (!list.length) return;
        html += '<div class="slot-group"><h4>' + g[0] + '</h4><div class="slots">' + list.map(function (s) {
          return '<button type="button" class="slot" data-time="' + s.time + '"' + (s.available ? "" : ' disabled aria-label="' + fmtTime(s.time) + ', booked"') + ' aria-pressed="false">' + fmtTime(s.time) + "</button>";
        }).join("") + "</div></div>";
      });
      html += '<p class="hint">' + free.length + " open time" + (free.length === 1 ? "" : "s") + ". Times shown in Philadelphia time.</p>";
      w.innerHTML = html;
      w.querySelectorAll(".slot:not([disabled])").forEach(function (b) {
        b.onclick = function () {
          w.querySelectorAll(".slot").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true"); self.time = b.getAttribute("data-time"); self.opts.onChange && self.opts.onChange(true);
        };
      });
    }).catch(function (e) { w.innerHTML = '<p class="alert alert-error" role="alert">' + esc(e.message) + "</p>"; });
  };
  Picker.prototype.refresh = function () { if (this.date) this.pickDate(this.date); };

  /* ---------- booking page ---------- */
  function initBooking() {
    var state = { cat: null, service: null, stylist: "any", step: 1 };
    var steps = [null, $("#step-service"), $("#step-stylist"), $("#step-time"), $("#step-details")];
    var picker;

    // existing bookings saved on this device
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]").filter(function (x) { return x.date >= cfg.today; });
      if (saved.length) {
        var s = saved[0];
        $("#saved").innerHTML = '<p class="alert alert-ok">You have an appointment on ' + esc(fmtDate(s.date)) + " at " + fmtTime(s.time) + ' (' + esc(s.service) + '). <a href="' + esc(MANAGE_URL + "?id=" + encodeURIComponent(s.id) + "&t=" + encodeURIComponent(s.t)) + '">View, reschedule or cancel</a></p>';
      }
    } catch (e) {}

    // services
    state.cat = cfg.categories[0].category;
    function renderServices() {
      $("#cat-tabs").innerHTML = cfg.categories.map(function (c) { return '<button type="button" class="chip" aria-pressed="' + (c.category === state.cat) + '" data-cat="' + esc(c.category) + '">' + esc(c.category) + "</button>"; }).join("");
      $("#cat-tabs").querySelectorAll(".chip").forEach(function (b) { b.onclick = function () { state.cat = b.getAttribute("data-cat"); renderServices(); }; });
      var cat = cfg.categories.filter(function (c) { return c.category === state.cat; })[0];
      $("#svc-list").innerHTML = cat.services.map(function (s) {
        return '<button type="button" class="svc" data-svc="' + s.id + '" aria-pressed="' + (state.service === s.id) + '"><span class="svc-main"><span class="svc-name">' + esc(s.name) + '</span><span class="svc-desc">' + esc(s.desc) + '</span></span><span class="svc-meta"><span class="svc-price">from ' + money(s.price) + '</span><span class="svc-dur">' + fmtDur(s.duration) + "</span></span></button>";
      }).join("");
      $("#svc-list").querySelectorAll(".svc").forEach(function (b) {
        b.onclick = function () { state.service = b.getAttribute("data-svc"); renderServices(); if (picker) { picker.time = null; picker.refresh(); } go(2); };
      });
    }
    renderServices();

    // stylists
    function renderStylists() {
      var list = [{ id: "any", name: "Any available", role: "First open stylist — most times" }].concat(cfg.stylists);
      $("#stylists").innerHTML = list.map(function (s) {
        return '<button type="button" class="stylist" data-sty="' + s.id + '" aria-pressed="' + (state.stylist === s.id) + '"><span class="avatar" aria-hidden="true">' + (s.id === "any" ? "★" : esc(s.name[0])) + "</span><span><strong>" + esc(s.name) + "</strong><small>" + esc(s.role) + "</small></span></button>";
      }).join("");
      $("#stylists").querySelectorAll(".stylist").forEach(function (b) {
        b.onclick = function () { state.stylist = b.getAttribute("data-sty"); renderStylists(); if (picker) { picker.time = null; picker.refresh(); } go(3); };
      });
    }
    renderStylists();
    $("#stylist-continue").onclick = function () { go(3); };

    picker = new Picker($("#picker"), {
      service: function () { return state.service; }, stylist: function () { return state.stylist; },
      onChange: function (picked) { update(); if (picked) go(4); },
    });

    function stepSummary(n) {
      var svc = state.service && findService(state.service);
      if (n === 1) return svc ? svc.name + " · " + fmtDur(svc.duration) + " · from " + money(svc.price) : "";
      if (n === 2) return stylistName(state.stylist);
      if (n === 3) return picker.date && picker.time ? fmtDate(picker.date, true) + " at " + fmtTime(picker.time) : "";
      return "";
    }
    function ready(n) { return n === 1 || (n >= 2 && state.service) && (n < 4 || (picker.date && picker.time)); }
    function go(n) {
      if (!ready(n)) return;
      state.step = n; update();
      var el = steps[n];
      requestAnimationFrame(function () {
        var top = el.getBoundingClientRect().top + scrollY - 90;
        if (Math.abs(top - scrollY) > 40) scrollTo({ top: top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        var f = el.querySelector(n === 4 ? "input" : "[aria-pressed='true'], .step-body button"); if (f && n === 4) f.focus({ preventScroll: true });
      });
    }
    function update() {
      if (!document.body.contains(steps[1])) return;
      for (var n = 1; n <= 4; n++) {
        var el = steps[n], sum = stepSummary(n), done = !!sum && ready(n) && n !== state.step && (n !== 3 || !!picker.time);
        el.classList.toggle("collapsed", n !== state.step);
        el.classList.toggle("locked", !ready(n));
        el.classList.toggle("done", done);
        el.querySelector(".step-title small").textContent = n === state.step ? el.getAttribute("data-hint") : (sum || el.getAttribute("data-hint"));
        var edit = el.querySelector(".step-edit"); edit.hidden = n === state.step || !ready(n);
      }
      var svc = state.service && findService(state.service);
      var rows = "<li><span>Service</span><span>" + (svc ? esc(svc.name) : "—") + "</span></li><li><span>Duration</span><span>" + (svc ? fmtDur(svc.duration) : "—") + "</span></li><li><span>Stylist</span><span>" + esc(stylistName(state.stylist)) + "</span></li><li><span>Date</span><span>" + (picker && picker.date ? esc(fmtDate(picker.date)) : "—") + "</span></li><li><span>Time</span><span>" + (picker && picker.time ? fmtTime(picker.time) : "—") + "</span></li>";
      $("#sum-list").innerHTML = rows;
      $("#sum-price").textContent = svc ? "from " + money(svc.price) : "—";
      var mb = $("#mobile-bar");
      mb.hidden = !svc;
      $("#mb-title").textContent = svc ? svc.name : "";
      $("#mb-sub").textContent = svc ? (picker.date && picker.time ? fmtDate(picker.date) + ", " + fmtTime(picker.time) : "from " + money(svc.price) + " · " + fmtDur(svc.duration)) : "";
      $("#mb-btn").textContent = state.step === 4 && picker.time ? "Confirm" : "Continue";
      $("#confirm-btn").disabled = !(svc && picker.date && picker.time);
    }
    steps.forEach(function (el, n) { if (el) el.querySelector(".step-edit").onclick = function () { go(n); }; });
    $("#mb-btn").onclick = function () {
      if (state.step === 4 && picker.time) { $("#details-form").requestSubmit(); return; }
      var next = !state.service ? 1 : state.step < 3 ? state.step + 1 : (picker.time ? 4 : 3); go(next);
    };

    $("#details-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target, err = $("#form-error"), btn = $("#confirm-btn");
      err.hidden = true;
      f.querySelectorAll("[aria-invalid]").forEach(function (x) { x.removeAttribute("aria-invalid"); });
      if (!f.checkValidity()) { var bad = f.querySelector(":invalid"); bad.setAttribute("aria-invalid", "true"); bad.focus(); bad.reportValidity(); return; }
      if (!state.service || !picker.date || !picker.time) { go(!state.service ? 1 : 3); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Booking…';
      api("/api/bookings", { method: "POST", body: { service: state.service, stylist: state.stylist, date: picker.date, time: picker.time, name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value, website: f.website.value } })
        .then(function (d) { tokens[d.booking.id] = d.token; remember(d.booking, d.token); showConfirmation(d.booking); })
        .catch(function (e) {
          err.textContent = e.message; err.hidden = false;
          if (e.status === 409) { picker.time = null; picker.refresh(); go(3); var w = $("#picker .slots-wrap"); w.insertAdjacentHTML("afterbegin", '<p class="alert alert-error" role="alert">' + esc(e.message) + "</p>"); }
        })
        .then(function () { btn.disabled = false; btn.textContent = "Confirm booking"; update(); });
    });

    function showConfirmation(b) {
      $("#mobile-bar").hidden = true;
      var link = manageLink(b);
      $("#book-main").style.display = "block";
      $("#book-main").innerHTML = '<div class="confirm" tabindex="-1" id="confirm"><div class="check" aria-hidden="true">✓</div><p class="section-label">You\'re booked</p><h2>See you ' + esc(fmtDate(b.date, true)) + "!</h2><p>Your booking reference</p><div class=\"ref\">" + esc(b.id) + "</div>" + bookingRows(b) + calActions(b) +
        '<p class="hint" style="margin-top:22px">Save this private link to view, reschedule or cancel your appointment:</p><div class="manage-link"><input readonly aria-label="Your manage booking link" value="' + esc(link) + '"><button type="button" class="btn btn-outline" data-copy>Copy</button></div>' +
        '<p class="hint" style="margin-top:18px">Need anything? Call <a href="tel:' + cfg.salon.phoneE164 + '">' + esc(cfg.salon.phone) + '</a>. Please arrive with hair washed and detangled unless you booked a wash.</p><div class="actions"><a class="btn btn-outline" href="' + esc(link) + '">Manage booking</a><a class="btn btn-outline" href="../">Back to the salon</a></div></div>';
      $("#confirm [data-ics]").onclick = function () { downloadIcs(b); };
      $("#confirm [data-copy]").onclick = function (e) { var i = $("#confirm .manage-link input"); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.resolve(document.execCommand("copy"))).then(function () { e.target.textContent = "Copied"; }); };
      scrollTo({ top: $("#book-main").getBoundingClientRect().top + scrollY - 100, behavior: "instant" });
      $("#confirm").focus({ preventScroll: true });
      document.title = "Booked: " + b.id + " | Afro Vibes Beauty Hub";
    }
    update();
  }

  /* ---------- manage page ---------- */
  function initManage() {
    var qs = new URLSearchParams(location.search), id = qs.get("id"), t = qs.get("t"), box = $("#manage");
    if (!id || !t) { box.innerHTML = '<div class="confirm"><h2>Find your booking</h2><p>Open the private link from your booking confirmation to view, reschedule or cancel. Lost it? Call <a href="tel:+12155589643">(215) 558-9643</a>.</p><div class="actions"><a class="btn btn-primary" href="' + BOOK_URL + '">Book an appointment</a></div></div>'; return; }
    tokens[id] = t;
    function render(b, canChange, msg) {
      var cancelled = b.status === "cancelled";
      var html = '<div class="confirm" id="mcard" tabindex="-1">' + (msg ? '<p class="alert alert-ok" role="status">' + esc(msg) + "</p>" : "") +
        '<p class="section-label">Your appointment</p><h2>' + esc(b.service.name) + '</h2><p><span class="status-pill ' + esc(b.status) + '">' + esc(b.status.replace("_", "-")) + '</span></p><div class="ref">' + esc(b.id) + "</div>" + bookingRows(b);
      if (!cancelled) html += calActions(b);
      if (b.status === "booked" && canChange) html += '<div class="actions"><button type="button" class="btn btn-primary" data-resched>Reschedule</button><button type="button" class="btn btn-danger" data-cancel>Cancel appointment</button></div><div id="resched" hidden style="text-align:left;margin-top:22px"><h3>Pick a new time</h3><div id="rpicker"></div><div class="actions"><button type="button" class="btn btn-primary" data-rsave disabled>Confirm new time</button><button type="button" class="btn btn-outline" data-rclose>Keep current time</button></div></div><div id="cconfirm" hidden><p class="alert alert-error">Cancel this appointment? The time will be released to other clients.</p><div class="actions"><button type="button" class="btn btn-danger" data-cyes>Yes, cancel it</button><button type="button" class="btn btn-outline" data-cno>Keep it</button></div></div>';
      else if (b.status === "booked") html += '<p class="hint" style="margin-top:16px">Online changes close ' + cfg.changeCutoffHours + ' hours before your appointment. To change it now, call <a href="tel:' + cfg.salon.phoneE164 + '">' + esc(cfg.salon.phone) + "</a>.</p>";
      if (cancelled) html += '<div class="actions"><a class="btn btn-primary" href="' + BOOK_URL + '">Book a new appointment</a></div>';
      html += '<p class="alert alert-error" id="merr" role="alert" hidden></p><p class="hint" style="margin-top:18px"><a href="../../">Back to Afro Vibes Beauty Hub</a></p></div>';
      box.innerHTML = html;
      var err = $("#merr"), fail = function (e) { err.textContent = e.message; err.hidden = false; };
      if (!cancelled) $("#mcard [data-ics]").onclick = function () { downloadIcs(b); };
      if (!(b.status === "booked" && canChange)) return;
      var rp;
      $("[data-resched]").onclick = function () {
        $("#resched").hidden = false; $("#cconfirm").hidden = true;
        if (!rp) rp = new Picker($("#rpicker"), { service: function () { return b.service.id; }, stylist: function () { return b.stylistPref; }, exclude: function () { return "&exclude=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(t); }, onChange: function () { $("[data-rsave]").disabled = !rp.time; } });
        $("#resched").scrollIntoView({ behavior: "smooth", block: "start" });
      };
      $("[data-rclose]").onclick = function () { $("#resched").hidden = true; };
      $("[data-rsave]").onclick = function (e) {
        e.target.disabled = true;
        api("/api/bookings/" + id + "/reschedule", { method: "POST", body: { t: t, date: rp.date, time: rp.time } })
          .then(function (d) { remember(d.booking, t); render(d.booking, d.canChange, "Rescheduled. Your new time is saved — update your calendar below."); var mc = $("#mcard"); scrollTo({ top: mc.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }); mc.focus({ preventScroll: true }); })
          .catch(function (x) { fail(x); rp.refresh(); });
      };
      $("[data-cancel]").onclick = function () { $("#cconfirm").hidden = false; $("#resched").hidden = true; };
      $("[data-cno]").onclick = function () { $("#cconfirm").hidden = true; };
      $("[data-cyes]").onclick = function (e) {
        e.target.disabled = true;
        api("/api/bookings/" + id + "/cancel", { method: "POST", body: { t: t } })
          .then(function (d) { render(d.booking, false, "Your appointment has been cancelled."); var mc = $("#mcard"); scrollTo({ top: mc.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }); mc.focus({ preventScroll: true }); })
          .catch(fail);
      };
    }
    api("/api/bookings/" + encodeURIComponent(id) + "?t=" + encodeURIComponent(t))
      .then(function (d) { render(d.booking, d.canChange); })
      .catch(function (e) { box.innerHTML = '<div class="confirm"><h2>Booking not found</h2><p>' + esc(e.message) + ' Check the link from your confirmation or call <a href="tel:+12155589643">(215) 558-9643</a>.</p></div>'; });
  }

  function renderPolicies() {
    var el = $("#policy-grid"); if (!el) return;
    el.innerHTML = cfg.policies.map(function (p) { return '<article class="policy"><h3>' + esc(p.title) + "</h3><p>" + esc(p.text) + "</p></article>"; }).join("");
  }

  api("/api/config").then(function (c) {
    cfg = c; renderPolicies();
    if (document.body.getAttribute("data-mode") === "manage") initManage(); else initBooking();
  }).catch(function (e) {
    var t = $("#book-main") || $("#manage");
    if (t) t.innerHTML = '<p class="alert alert-error" role="alert">' + esc(e.message) + "</p>";
  });
})();
