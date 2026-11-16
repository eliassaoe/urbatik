// admin-dossiers : la page /admin/dossiers, protégée par un mot de passe (pas de compte Supabase).
//
//   {action:'login', password}            → jeton de session signé, valable 30 jours
//   {action:'list', token}                → commandes (500 dernières) + photos reçues par commande
//   {action:'get', token, id}             → commande, fichiers avec liens signés 7 jours
//   {action:'update', token, id, status, admin_notes}
//   {action:'crm_list', token}          → prospects pour /admin/prospects
//   {action:'crm_update', token, email, fields, create?}
//   {action:'clients', token}             → fichier clients (dossier_clients), payeurs ou non
//
// ADMIN_PASSWORD : choisi par le gérant, saisi par lui dans dossier_settings (jamais dans le dépôt).
// ADMIN_SESSION_SECRET : aléatoire, dans dossier_settings ; le changer déconnecte tout le monde.
// Déployer avec --no-verify-jwt.

import { admin, json, loadSettings, CORS, env, BUCKET, SITE_URL, sendEmail, emailShell, esc, TYPES, TypeDossier } from '../_shared/dossier-express.ts';

const STATUSES = ['en_attente_paiement', 'payee', 'en_preparation', 'en_relecture', 'livree', 'deposee', 'annulee', 'remboursee'];
const DAYS_30 = 30 * 86_400_000;

async function sign(msg: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('ADMIN_SESSION_SECRET')),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
    return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function same(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

async function validToken(t: unknown): Promise<boolean> {
    if (typeof t !== 'string' || !env('ADMIN_SESSION_SECRET')) return false;
    const [exp, sig] = t.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    return same(sig, await sign('admin.' + exp));
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    await loadSettings();
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
    const db = admin();

    if (body.action === 'login') {
        const pw = env('ADMIN_PASSWORD');
        if (!pw || !env('ADMIN_SESSION_SECRET')) return json({ error: 'non_configure' }, 503);
        if (typeof body.password !== 'string' || !same(body.password, pw)) {
            await new Promise(r => setTimeout(r, 900));
            return json({ error: 'mot_de_passe' }, 401);
        }
        const exp = String(Date.now() + DAYS_30);
        return json({ token: `${exp}.${await sign('admin.' + exp)}` });
    }

    if (!(await validToken(body.token))) return json({ error: 'session' }, 401);

    if (body.action === 'list') {
        const { data: orders, error } = await db.from('orders')
            .select('id, created_at, status, type_dossier, entreprise, ville, code_postal, contact_nom, contact_email, contact_tel, montant_ht_cents, amount_paid_cents, offre_10min, paid_at, utm')
            .order('created_at', { ascending: false }).limit(500);
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        const ids = (orders ?? []).map(o => o.id);
        const { data: files } = ids.length ? await db.from('order_files').select('order_id, kind').in('order_id', ids) : { data: [] };
        const kinds: Record<string, string[]> = {};
        for (const f of files ?? []) (kinds[f.order_id] ??= []).push(f.kind);
        return json({ orders: (orders ?? []).map(o => ({ ...o, file_kinds: kinds[o.id] ?? [] })) });
    }

    if (body.action === 'get') {
        const { data: o } = await db.from('orders').select('*').eq('id', String(body.id ?? '')).maybeSingle();
        if (!o) return json({ error: 'not_found' }, 404);
        const { data: files } = await db.from('order_files').select('*').eq('order_id', o.id).order('created_at');
        const list = files ?? [];
        const { data: signed } = list.length
            ? await db.storage.from(BUCKET).createSignedUrls(list.map(f => f.storage_path), 7 * 86_400)
            : { data: [] };
        const { client_token: _t, ...order } = o;
        return json({
            order, suivi_url: `${SITE_URL}/suivi?token=${o.client_token}`,
            files: list.map((f, i) => ({ ...f, url: signed?.[i]?.signedUrl ?? null })),
        });
    }

    if (body.action === 'update') {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof body.status === 'string') {
            if (!STATUSES.includes(body.status)) return json({ error: 'status' }, 422);
            patch.status = body.status;
        }
        if (typeof body.admin_notes === 'string') patch.admin_notes = body.admin_notes.slice(0, 20000);
        const { data: o, error } = await db.from('orders').update(patch).eq('id', String(body.id ?? '')).select('*').maybeSingle();
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        // Livré : on demande un avis au client, une seule fois.
        if (o && o.status === 'livree' && !o.review_requested_at) {
            const lien = `${SITE_URL}/avis?token=${o.client_token}`;
            const ok = await sendEmail(o.contact_email, 'Votre dossier est livré – un avis en 30 secondes ?', emailShell(`
<p>Bonjour ${esc(String(o.contact_nom).split(' ')[0])},</p>
<p>Votre ${esc(TYPES[o.type_dossier as TypeDossier].label.toLowerCase())} pour ${esc(o.ville)} est livré. Merci pour votre confiance.</p>
<p>Votre avis aide d'autres artisans à nous choisir. Ça prend 30 secondes :</p>
<p><a href="${esc(lien)}" style="display:inline-block;background:#0b0b0c;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Donner mon avis</a></p>`),
                `Votre dossier est livré. Votre avis en 30 secondes : ${lien}`);
            if (ok) await db.from('orders').update({ review_requested_at: new Date().toISOString() }).eq('id', o.id);
        }
        return json({ ok: true });
    }

    if (body.action === 'reviews') {
        const { data, error } = await db.from('dossier_avis').select('*').order('created_at', { ascending: false }).limit(500);
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        return json({ reviews: data ?? [] });
    }

    if (body.action === 'review_approve') {
        const { error } = await db.from('dossier_avis').update({ approved: Boolean(body.approved) }).eq('id', String(body.id ?? ''));
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        return json({ ok: true });
    }

    if (body.action === 'clients') {
        const { data, error } = await db.from('dossier_clients').select('*').order('updated_at', { ascending: false }).limit(1000);
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        return json({ clients: data ?? [] });
    }

    // Suivi commercial : page /admin/prospects. Tout contact sauf les adresses internes, visites en tête.
    if (body.action === 'crm_list') {
        const { data, error } = await db.from('dossier_clients')
            .select('email, nom, entreprise, tel, metier, source, utm, visits, visited_at, last_visit_at, first_seen_at, offer_started_at, crm_status, crm_next, crm_relance, crm_notes, crm_said, crm_updated_at, crm_called_at, crm_call_result, crm_calls, crm_done_at')
            .not('email', 'ilike', '%linkfinderai%').neq('email', 'hamoureliasse@gmail.com')
            .order('last_visit_at', { ascending: false, nullsFirst: false }).limit(2000);
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        const emails = (data ?? []).map(c => c.email);
        const { data: paid } = emails.length ? await db.from('orders').select('contact_email, status, paid_at').in('contact_email', emails) : { data: [] };
        const orders: Record<string, { status: string; paid: boolean }[]> = {};
        for (const o of paid ?? []) (orders[o.contact_email] ??= []).push({ status: o.status, paid: !!o.paid_at });
        return json({ prospects: (data ?? []).map(c => ({ ...c, orders: orders[c.email] ?? [] })), now: new Date().toISOString() });
    }

    if (body.action === 'crm_update') {
        const email = String(body.email ?? '').trim().toLowerCase();
        if (!email.includes('@')) return json({ error: 'email' }, 422);
        const CRM = ['a_appeler', 'rappel', 'pas_repondu', 'lien_envoye', 'rdv', 'client', 'perdu'];
        const f = body.fields ?? {};
        const patch: Record<string, unknown> = { email, crm_updated_at: new Date().toISOString() };
        if (typeof f.crm_status === 'string') { if (!CRM.includes(f.crm_status)) return json({ error: 'status' }, 422); patch.crm_status = f.crm_status; }
        for (const k of ['nom', 'entreprise', 'tel', 'metier', 'crm_next', 'crm_notes', 'crm_said']) {
            if (typeof f[k] === 'string') patch[k] = f[k].slice(0, 5000) || null;
        }
        if ('crm_relance' in f) patch.crm_relance = /^\d{4}-\d{2}-\d{2}$/.test(String(f.crm_relance ?? '')) ? f.crm_relance : null;
        if (f.call === 'ok' || f.call === 'no_answer') {
            const { data: c } = await db.from('dossier_clients').select('crm_calls').eq('email', email).maybeSingle();
            patch.crm_called_at = patch.crm_updated_at; patch.crm_call_result = f.call; patch.crm_calls = (c?.crm_calls ?? 0) + 1;
            if (f.call === 'no_answer' && typeof f.crm_status !== 'string') patch.crm_status = 'pas_repondu';
        } else if (f.call === 'undo') {
            patch.crm_called_at = null; patch.crm_call_result = null; patch.crm_calls = 0;
        }
        if (typeof f.done === 'boolean') patch.crm_done_at = f.done ? patch.crm_updated_at : null;
        if (body.create) { patch.source = typeof f.source === 'string' ? f.source : 'manuel'; patch.updated_at = patch.crm_updated_at; }
        const { error } = body.create
            ? await db.from('dossier_clients').upsert(patch, { onConflict: 'email' })
            : await db.from('dossier_clients').update(patch).eq('email', email);
        if (error) { console.error(error); return json({ error: 'db' }, 500); }
        return json({ ok: true });
    }

    return json({ error: 'action' }, 400);
});
