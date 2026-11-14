// dossier-visit : enregistre la visite d'un prospect arrivé par un lien contenant son email (?e=…),
// pour pouvoir le relancer ensuite (fonction dossier-abandons). Public (appelé par le site), sans JWT.
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
    return json({ ok: true });
});
