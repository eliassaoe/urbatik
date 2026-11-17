// dossier-ia : ce que le générateur (GitHub Actions, workflow generer-dossier.yml) demande au serveur.
// Les clés restent ici, dans les secrets Supabase ; le workflow ne reçoit qu'un jeton à usage unique
// (3 h, une seule commande) créé par lancerGeneration().
//
//   {action:'commande', generation_id, token}           → la commande, la fiche, les photos (liens 1 h)
//   {action:'vision', generation_id, token, kind}       → portes et fenêtres lues sur une photo de façade
//   {action:'photomontage', generation_id, token, prompt} → DP6 : le projet inséré dans la vue d'ensemble
//   {action:'depot_url', generation_id, token}          → URL d'envoi signée pour le PDF
//   {action:'depot', generation_id, token, a_verifier}  → dossier prêt à relire, email à l'admin
//   {action:'echec', generation_id, token, message}     → échec, email à l'admin
//
// IA via OpenRouter (OPENROUTER_API_KEY). Modèles réglables dans dossier_settings :
// VISION_MODEL (défaut anthropic/claude-sonnet-4.5), IMAGE_MODEL (défaut openai/gpt-image-1).
// Déployer avec --no-verify-jwt.

import { admin, json, loadSettings, CORS, env, BUCKET, SITE_URL, sendEmail, emailShell, esc, sha256 } from '../_shared/dossier-express.ts';

const OR = 'https://openrouter.ai/api/v1';
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_VISION = 8, MAX_IMAGE = 3;

const CONSIGNE = `Tu regardes la photo d'une façade de maison, prise de face.
Repère le mur de la maison (de l'angle gauche à l'angle droit, du sol à la gouttière) et
chaque ouverture visible dans ce mur : porte, porte-fenêtre, fenêtre, baie, porte de garage.
Réponds uniquement en JSON, sans texte autour :
{"facade_visible": true|false,
 "photo_de_face": true|false,
 "ouvertures": [{"type": "porte|porte_fenetre|fenetre|baie|garage",
                 "x0": 0.00, "x1": 0.00, "bas": 0.00, "haut": 0.00, "volets": true|false}],
 "remarques": "ce qui empêche une lecture fiable, sinon vide"}
x0, x1 : bords gauche et droit de l'ouverture en fraction de la largeur du mur (0 à 1).
bas, haut : en fraction de la hauteur du mur entre le sol et la gouttière (0 à 1 ; > 1 si au-dessus).
N'invente rien : une ouverture cachée par une haie n'est pas listée, et tu le dis dans remarques.`;

function b64(buf: Uint8Array): string {
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
}

Deno.serve(async (req) => {
    await loadSettings();
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
    const db = admin();

    const { data: g } = await db.from('dossier_generations').select('*').eq('id', String(body.generation_id ?? '')).maybeSingle();
    if (!g || typeof body.token !== 'string' || (await sha256(body.token)) !== g.token_hash) return json({ error: 'not_found' }, 404);
    if (!['lancee', 'en_cours'].includes(g.status) || new Date(g.expires_at) < new Date()) return json({ error: 'expire' }, 410);
    const { data: o } = await db.from('orders').select('*').eq('id', g.order_id).maybeSingle();
    if (!o) return json({ error: 'not_found' }, 404);
    const maj = (patch: Record<string, unknown>) =>
        db.from('dossier_generations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', g.id);
    const { data: files } = await db.from('order_files').select('kind, storage_path, content_type, created_at').eq('order_id', o.id).order('created_at');
    const dernier = (kind: string) => [...(files ?? [])].reverse().find(f => f.kind === kind);

    if (body.action === 'commande') {
        await maj({ status: 'en_cours' });
        const imgs = (files ?? []).filter(f => IMAGES.includes(f.content_type ?? ''));
        const { data: signed } = imgs.length ? await db.storage.from(BUCKET).createSignedUrls(imgs.map(f => f.storage_path), 3600) : { data: [] };
        const champs = ['type_dossier', 'type_ouvrage', 'adresse_chantier', 'code_postal', 'ville', 'contact_nom', 'nom_client_final',
            'hauteur_m', 'surface_m2', 'dimensions', 'materiaux', 'couleurs', 'description', 'distance_limites', 'fiche_technique'];
        return json({
            commande: Object.fromEntries(champs.map(k => [k, o[k]])),
            photos: imgs.map((f, i) => ({ kind: f.kind, type: f.content_type, url: signed?.[i]?.signedUrl ?? null })),
        });
    }

    if (body.action === 'vision') {
        if (g.appels_vision >= MAX_VISION) return json({ error: 'quota' }, 429);
        const f = dernier(String(body.kind ?? ''));
        if (!f || !IMAGES.includes(f.content_type ?? '')) return json({ ouvertures: [], remarques: 'photo absente ou format non lisible' });
        const { data: blob } = await db.storage.from(BUCKET).download(f.storage_path);
        if (!blob) return json({ error: 'storage' }, 500);
        await maj({ appels_vision: g.appels_vision + 1 });
        const r = await fetch(`${OR}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json', 'X-Title': 'Urbatik' },
            body: JSON.stringify({
                model: env('VISION_MODEL', 'anthropic/claude-sonnet-4.5'), max_tokens: 1500,
                messages: [{ role: 'user', content: [
                    { type: 'image_url', image_url: { url: `data:${f.content_type};base64,${b64(new Uint8Array(await blob.arrayBuffer()))}` } },
                    { type: 'text', text: CONSIGNE }] }],
            }),
        });
        const rep = await r.json().catch(() => ({}));
        if (!r.ok) return json({ error: 'openrouter', detail: rep?.error?.message ?? r.status }, 502);
        const texte = String(rep.choices?.[0]?.message?.content ?? '');
        try { return json(JSON.parse(texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1))); }
        catch { return json({ ouvertures: [], remarques: 'réponse illisible' }); }
    }

    if (body.action === 'photomontage') {
        if (g.appels_image >= MAX_IMAGE) return json({ error: 'quota' }, 429);
        const f = dernier('photo_ensemble');
        if (!f || !IMAGES.includes(f.content_type ?? '')) return json({ error: 'photo_absente' }, 422);
        const { data: blob } = await db.storage.from(BUCKET).download(f.storage_path);
        if (!blob) return json({ error: 'storage' }, 500);
        await maj({ appels_image: g.appels_image + 1 });
        const r = await fetch(`${OR}/images`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json', 'X-Title': 'Urbatik' },
            body: JSON.stringify({
                model: env('IMAGE_MODEL', 'openai/gpt-image-1'), prompt: String(body.prompt ?? '').slice(0, 3000), n: 1, output_format: 'png',
                input_references: [{ type: 'image_url', image_url: { url: `data:${f.content_type};base64,${b64(new Uint8Array(await blob.arrayBuffer()))}` } }],
            }),
        });
        const rep = await r.json().catch(() => ({}));
        const img = rep?.data?.[0]?.b64_json;
        if (!r.ok || !img) return json({ error: 'openrouter', detail: rep?.error?.message ?? r.status }, 502);
        const path = `${o.id}/generation-${g.id.slice(0, 8)}-insertion.png`;
        const bytes = Uint8Array.from(atob(img), c => c.charCodeAt(0));
        const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
        if (error) { console.error(error); return json({ error: 'storage' }, 500); }
        await maj({ insertion_path: path });
        const { data: s } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
        return json({ url: s?.signedUrl });
    }

    if (body.action === 'depot_url') {
        const path = `${o.id}/dossier-genere-${g.id.slice(0, 8)}.pdf`;
        const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !data) { console.error(error); return json({ error: 'storage' }, 500); }
        return json({ path, url: data.signedUrl });
    }

    if (body.action === 'depot') {
        const path = `${o.id}/dossier-genere-${g.id.slice(0, 8)}.pdf`;
        const a_verifier = Array.isArray(body.a_verifier) ? body.a_verifier.map(String).slice(0, 40) : [];
        await maj({ status: 'a_relire', pdf_path: path, a_verifier });
        if (o.status === 'payee') await db.from('orders').update({ status: 'en_preparation', updated_at: new Date().toISOString() }).eq('id', o.id);
        const lien = `${SITE_URL}/admin/dossiers#${o.id}`;
        await sendEmail(env('ADMIN_EMAIL'), `Dossier généré, à relire – ${o.entreprise} – ${o.ville}`,
            emailShell(`<p>Le générateur a préparé le dossier de ${esc(o.contact_nom)}.</p>
<p>À vérifier :</p><ul>${a_verifier.map((x: string) => `<li>${esc(x)}</li>`).join('') || '<li>rien de signalé</li>'}</ul>
<p><a href="${esc(lien)}">Ouvrir le dossier dans l'admin</a></p>`),
            `Dossier généré pour ${o.contact_nom}, à relire : ${lien}`);
        return json({ ok: true });
    }

    if (body.action === 'echec') {
        const erreur = String(body.message ?? 'échec').slice(0, 500);
        await maj({ status: 'echec', erreur });
        await sendEmail(env('ADMIN_EMAIL'), `Génération échouée – ${o.entreprise} – ${o.ville}`,
            emailShell(`<p>Le générateur n'a pas pu préparer ce dossier : ${esc(erreur)}</p><p><a href="${esc(`${SITE_URL}/admin/dossiers#${o.id}`)}">Ouvrir le dossier</a></p>`),
            `Génération échouée : ${erreur}`);
        return json({ ok: true });
    }

    return json({ error: 'action' }, 400);
});
