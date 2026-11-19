// dossier-visit : enregistre la visite d'un prospect arrivé par un lien contenant son email (?e=…),
// pour pouvoir le relancer ensuite (fonction dossier-abandons). Public (appelé par le site), sans JWT.
// Prospect prioritaire (18 nov. 2026, décision du gérant) : s'il nous a déjà répondu (replied_at) ou s'il revient
// (2e visite et plus), le gérant reçoit un email tout de suite pour l'appeler. Au plus un par 12 h et par prospect.
// Source : eliassaoe/urbatik, supabase/functions/dossier-visit/index.ts

import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
    const email = str(body.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email' }, 422);
    // Réponses du formulaire (dernier écran, pas encore payé) : les relances renvoient un lien qui les rouvre (?d=).
    if (body.action === 'draft') {
        const d: Record<string, string> = {};
        for (const [k, v] of Object.entries((body.fields ?? {}) as Record<string, unknown>)) {
            if (/^[a-z_]{2,40}$/.test(k) && typeof v === 'string' && Object.keys(d).length < 40) d[k] = v.slice(0, 400);
        }
        const now = new Date().toISOString();
        const { error } = await db.from('dossier_clients').upsert({ email, draft: d, draft_at: now, updated_at: now }, { onConflict: 'email' });
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        return json({ ok: true });
    }
    const utm: Record<string, string> = {};
    for (const [k, v] of Object.entries((body.utm ?? {}) as Record<string, unknown>)) {
        if (/^utm_(source|medium|campaign|content|term)$/.test(k)) utm[k] = str(v, 120);
    }
    const now = new Date().toISOString();
    const { data: c } = await db.from('dossier_clients').select('email, visits, visited_at').eq('email', email).maybeSingle();
    if (c) {
        await db.from('dossier_clients').update({ last_visit_at: now, visits: (c.visits ?? 0) + 1, visited_at: c.visited_at ?? now, updated_at: now }).eq('email', email);
    } else {
        await db.from('dossier_clients').insert({
            email, visited_at: now, last_visit_at: now, visits: 1, updated_at: now,
            source: str(body.source, 40) || (utm.utm_campaign ? `email_${utm.utm_campaign}` : 'lien_email'),
            ...(Object.keys(utm).length ? { utm } : {}),
        });
    }
    await alertOwner(email, String(body.page ?? '').slice(0, 80));
    return json({ ok: true });
});

async function alertOwner(email: string, page: string) {
    try {
        const { data: c } = await db.from('dossier_clients')
            .select('email, nom, entreprise, tel, metier, visits, replied_at, priority_alert_at, offer_started_at').eq('email', email).maybeSingle();
        if (!c || /@linkfinderai\.com$/i.test(email)) return;
        const hot = !!c.replied_at || (c.visits ?? 0) >= 2;
        if (!hot) return;
        if (c.priority_alert_at && Date.now() - new Date(c.priority_alert_at).getTime() < 12 * 3_600_000) return;
        const { data: rows } = await db.from('dossier_settings').select('key, value').in('key', ['N8N_EMAIL_WEBHOOK', 'ADMIN_EMAIL']);
        const S = Object.fromEntries((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
        const hook = Deno.env.get('N8N_EMAIL_WEBHOOK') || S.N8N_EMAIL_WEBHOOK, to = Deno.env.get('ADMIN_EMAIL') || S.ADMIN_EMAIL;
        if (!hook || !to) return;
        const why = c.replied_at ? 'a répondu à la prospection et vient sur le site' : `revient sur le site (${c.visits}e visite)`;
        const lines = [
            `${c.nom || email} ${why}.`, '',
            `Entreprise : ${c.entreprise || '—'}`, `Métier / campagne : ${c.metier || '—'}`,
            `Téléphone : ${c.tel || 'inconnu (voir le fil Explee)'}`, `Email : ${email}`,
            `Page : ${page || '/'}`, `Visites : ${c.visits ?? 1}`, '',
            `À appeler maintenant, pendant qu'il regarde.`,
        ];
        const esc = (x: string) => x.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!));
        await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            to, subject: `🔥 À appeler : ${c.nom || email}${c.entreprise ? ' (' + c.entreprise + ')' : ''} est sur Urbatik`,
            html: lines.map(l => `<p style="margin:0 0 6px">${esc(l)}</p>`).join(''), text: lines.join('\n'), from_name: 'Urbatik',
        }) });
        await db.from('dossier_clients').update({ priority_alert_at: new Date().toISOString() }).eq('email', email);
    } catch (e) { console.error(e); }
}
