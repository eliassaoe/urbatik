/* Urbatik – commun à toutes les pages publiques.
 * 1. Lien personnalisé : ?e=email (liens Explee). On garde l'email (localStorage), on pré-remplit le formulaire,
 *    on enregistre la visite (fonction dossier-visit) pour les relances, puis on retire l'email de l'URL.
 * 2. Bouton WhatsApp flottant (sauf sur le formulaire de commande).
 */
(function () {
  var KEY = "urbatik_email", DRAFT = "dx_draft_v1";
  var VISIT = "https://snxhsboboatjywgwdeds.supabase.co/functions/v1/dossier-visit";
  var APIKEY = "sb_publishable_RKidGRs4ch1ixmRfXoYSww_UsQMSe5w";
  var WA = "33626344475";
  var ok = function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ""); };
  try {
    var url = new URL(location.href);
    var e = (url.searchParams.get("e") || url.searchParams.get("email") || "").trim().toLowerCase();
    if (ok(e)) {
      try { localStorage.setItem(KEY, e); } catch (x) {}
      try {
        var d = JSON.parse(localStorage.getItem(DRAFT) || "{}");
        if (!d.contact_email) { d.contact_email = e; localStorage.setItem(DRAFT, JSON.stringify(d)); }
      } catch (x) {}
      var utm = {};
      url.searchParams.forEach(function (v, k) { if (/^utm_/.test(k)) utm[k] = v; });
      fetch(VISIT, { method: "POST", headers: { "Content-Type": "application/json", apikey: APIKEY },
        body: JSON.stringify({ email: e, utm: utm, page: location.pathname }), keepalive: true }).catch(function () {});
      var cap = function () { try { posthog.capture("dossier_express_lead_link_visit", { page: location.pathname, utm_campaign: utm.utm_campaign || null }); } catch (x) {} };
      if (window.posthog) setTimeout(cap, 0); else addEventListener("load", cap);
      url.searchParams.delete("e"); url.searchParams.delete("email");
      history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
    }
    var known = ""; try { known = localStorage.getItem(KEY) || ""; } catch (x) {}
    if (ok(known)) {
      var id = function () { try { if (window.posthog && posthog.identify) posthog.identify(known, { email: known }); } catch (x) {} };
      if (document.readyState === "complete") id(); else addEventListener("load", id);
    }
  } catch (x) {}

  if (!/^\/commande/.test(location.pathname)) {
    addEventListener("DOMContentLoaded", function () {
      var a = document.createElement("a");
      a.href = "https://wa.me/" + WA + "?text=" + encodeURIComponent("Bonjour, j'ai une question sur un dossier de mairie.");
      a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", "Écrire sur WhatsApp");
      a.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:50;width:56px;height:56px;border-radius:50%;background:#25d366;display:grid;place-items:center;box-shadow:0 6px 20px rgba(0,0,0,.18)";
      a.innerHTML = '<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 2 6.8L3 29l6.8-2.2c1.9 1.1 4 1.6 6.2 1.6 7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23c-2 0-3.9-.6-5.6-1.6l-.4-.2-4 1.3 1.3-3.9-.3-.4c-1.2-1.7-1.8-3.6-1.8-5.6C5.2 9.9 10 5.2 16 5.2s10.8 4.7 10.8 10.5S22 26 16 26zm5.9-7.8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8 0 1.6 1.2 3.2 1.4 3.4.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';
      a.addEventListener("click", function () { try { window.posthog && posthog.capture("dossier_express_click_whatsapp", { page: location.pathname }); } catch (x) {} });
      document.body.appendChild(a);
    });
  }
})();
