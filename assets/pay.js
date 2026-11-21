/* Prebuilt Site: on-page Stripe checkout.
 * Turns the three "Make this site yours" Payment Link buttons into a pop-up
 * Stripe Embedded Checkout, so the buyer pays without leaving the page.
 * Until PUBLISHABLE_KEY and ENDPOINT are filled in, this script does nothing
 * and the buttons keep working as plain Payment Links (the fallback).
 */
(function () {
  "use strict";
  var PUBLISHABLE_KEY = "pk_live_51UcDGrBE99wfj63pQgUg9J8ghjr1d4EYIqXJctYX9wlF1XMnQJGivT31k7GXl71b54JPi0KtVoNrKibBlKmHDvd700pQPXLYcl"; // pk_live_... from Stripe Dashboard > Developers > API keys
  var ENDPOINT = "https://prebuilt-checkout.netlify.app";        // Netlify Functions backend

  var PLANS = {
    "https://buy.stripe.com/00w9ASbqe0e85aM5y80co00": "setup",
    "https://buy.stripe.com/4gM4gybqed0U32E0dO0co05": "yearly",
    "https://buy.stripe.com/aFacN48e25ys9r29Oo0co01": "final"
  };

  var params = new URLSearchParams(location.search);
  var slug = (location.pathname.split("/").filter(Boolean)[0] || "home").slice(0, 80);

  function css() {
    if (document.getElementById("ps-pay-css")) return;
    var s = document.createElement("style");
    s.id = "ps-pay-css";
    s.textContent =
      ".ps-pay-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(15,15,20,.6);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:4vh 12px}" +
      ".ps-pay-box{position:relative;background:#fff;color:#222;width:100%;max-width:560px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:44px 8px 12px;min-height:240px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
      ".ps-pay-close{position:absolute;top:8px;right:10px;border:0;background:transparent;font-size:28px;line-height:1;cursor:pointer;color:#444;padding:4px 10px}" +
      ".ps-pay-msg{text-align:center;padding:60px 16px;color:#555}" +
      ".ps-pay-banner{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483000;background:#14532d;color:#fff;padding:14px 20px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:15px/1.4 system-ui,sans-serif;max-width:92vw;text-align:center}" +
      "body.ps-pay-open{overflow:hidden}";
    document.head.appendChild(s);
  }

  // Thank-you note after Stripe returns the buyer to this page.
  if (params.get("paid") && ENDPOINT) {
    fetch(ENDPOINT + "/session-status?session_id=" + encodeURIComponent(params.get("paid")))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        css();
        var b = document.createElement("div");
        b.className = "ps-pay-banner";
        b.setAttribute("role", "status");
        b.textContent = d.status === "complete"
          ? "Thank you! Your payment went through. Warren will email you at " + (d.email || "your address") + " shortly."
          : "Your payment wasn't completed. You can try again below or email warren@prebuiltsite.com.";
        document.body.appendChild(b);
        setTimeout(function () { b.remove(); }, 12000);
      })
      .catch(function () {});
  }

  if (!PUBLISHABLE_KEY || !ENDPOINT) return; // not configured: links stay as-is

  var stripeReady = null;
  function loadStripe() {
    if (stripeReady) return stripeReady;
    stripeReady = new Promise(function (resolve, reject) {
      if (window.Stripe) return resolve(window.Stripe(PUBLISHABLE_KEY));
      var sc = document.createElement("script");
      sc.src = "https://js.stripe.com/v3/";
      sc.onload = function () { window.Stripe ? resolve(window.Stripe(PUBLISHABLE_KEY)) : reject(new Error("no Stripe")); };
      sc.onerror = function () { reject(new Error("Stripe.js failed to load")); };
      document.head.appendChild(sc);
    });
    stripeReady.catch(function () { stripeReady = null; });
    return stripeReady;
  }

  var current = null;
  function close() {
    if (!current) return;
    try { current.checkout && current.checkout.destroy(); } catch (e) {}
    current.overlay.remove();
    document.body.classList.remove("ps-pay-open");
    document.removeEventListener("keydown", onKey);
    if (current.opener) current.opener.focus();
    current = null;
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  function open(plan, link, opener) {
    css();
    var overlay = document.createElement("div");
    overlay.className = "ps-pay-overlay";
    overlay.innerHTML =
      '<div class="ps-pay-box" role="dialog" aria-modal="true" aria-label="Secure checkout">' +
      '<button type="button" class="ps-pay-close" aria-label="Close checkout">&times;</button>' +
      '<div class="ps-pay-msg">Loading secure checkout&hellip;</div>' +
      '<div id="ps-pay-mount"></div></div>';
    document.body.appendChild(overlay);
    document.body.classList.add("ps-pay-open");
    current = { overlay: overlay, opener: opener, checkout: null };
    var mine = current;
    overlay.querySelector(".ps-pay-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".ps-pay-close").focus();

    function fallback() { // anything fails: send them to the normal Payment Link
      if (current !== mine) return;
      close();
      location.href = link;
    }

    var fetchClientSecret = function () {
      return fetch(ENDPOINT + "/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan, slug: slug })
      }).then(function (r) {
        if (!r.ok) throw new Error("session " + r.status);
        return r.json();
      }).then(function (d) {
        if (!d.clientSecret) throw new Error("no clientSecret");
        return d.clientSecret;
      });
    };

    // Get the session first so a backend failure falls back to the Payment Link
    // instead of leaving an error inside the Stripe frame.
    var secretP = fetchClientSecret();
    Promise.all([loadStripe(), secretP]).then(function (res) {
      var stripe = res[0], secret = res[1];
      var make = stripe.createEmbeddedCheckoutPage || stripe.initEmbeddedCheckout;
      if (!make) throw new Error("embedded checkout unsupported");
      return make.call(stripe, { fetchClientSecret: function () { return Promise.resolve(secret); } });
    }).then(function (checkout) {
      if (current !== mine) { try { checkout.destroy(); } catch (e) {} return; }
      mine.checkout = checkout;
      var msg = overlay.querySelector(".ps-pay-msg");
      if (msg) msg.remove();
      checkout.mount("#ps-pay-mount");
    }).catch(fallback);
  }

  function wire() {
    var links = document.querySelectorAll('a[href^="https://buy.stripe.com/"]');
    Array.prototype.forEach.call(links, function (a) {
      var plan = PLANS[a.getAttribute("href")];
      if (!plan) return;
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
        e.preventDefault();
        open(plan, a.href, a);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
