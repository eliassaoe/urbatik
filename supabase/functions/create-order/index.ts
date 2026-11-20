// create-order : le formulaire /commande en deux appels.
//
// 1. {action:'create', fields, files:[{kind, name, type, size}], utm}
//    → valide, crée la commande (en_attente_paiement), renvoie une URL d'envoi
//      signée par fichier. Le navigateur envoie les fichiers directement dans
//      le bucket privé `dossiers` (rien ne transite par cette fonction).
// 2. {action:'checkout', order_id, token}
//    → vérifie que les fichiers sont bien arrivés, les enregistre dans
//      order_files, renvoie le lien de paiement Dodo du bon produit.
//
// Déployer avec --no-verify-jwt : la page est publique, sans compte.

import {
    admin, json, loadSettings, CORS, TYPES, OUVRAGES, FILE_KINDS, BUCKET, MAX_FILE_BYTES, ALLOWED_TYPES,
    SITE_URL, env, randomToken, safeName, offerStatus, TypeDossier,
    PRIX, prixOffre, ACOMPTE_CENTS, estFormule, paiementLibre, creerPaiement,
} from '../_shared/dossier-express.ts';

const DELAIS = ['asap', 'semaine', 'mois', 'ne_sait_pas'];

// Formulaire court (19 nov. 2026) : seuls le contact et l'adresse sont obligatoires avant le paiement.
// Le reste (dimensions, matériaux, propriétaire…) arrive après, par la fiche technique de /suivi.
// 20 nov. 2026 (parcours LegalPlace) : entreprise et téléphone facultatifs, seul le nom est demandé.
const TEXT = ['contact_nom', 'contact_email', 'adresse_chantier', 'code_postal', 'ville'];
const TEXT_OPT = ['nom_client_final', 'dimensions', 'distance_limites', 'materiaux', 'couleurs'];

function str(v: unknown, max = 500): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n < 100000 ? n : NaN;
}

function validate(f: Record<string, unknown>): { row?: Record<string, unknown>; errors: string[] } {
    const errors: string[] = [];
    const type = str(f.type_dossier) as TypeDossier;
    if (!(type in TYPES)) errors.push('type_dossier');
    const row: Record<string, unknown> = { type_dossier: type };
    for (const k of TEXT) {
        row[k] = str(f[k], k === 'adresse_chantier' ? 300 : 500);
        if (!row[k]) errors.push(k);
    }
    for (const k of TEXT_OPT) row[k] = str(f[k], 500) || null;
    row.entreprise = str(f.entreprise, 500) || row.contact_nom;   // colonnes non nulles : le nom tient lieu d'entreprise
    row.contact_tel = str(f.contact_tel, 50);
    row.contact_email = String(row.contact_email).toLowerCase();
    if (row.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.contact_email))) errors.push('contact_email');
    if (row.code_postal && !/^\d{5}$/.test(String(row.code_postal))) errors.push('code_postal');
    const ouvrage = str(f.type_ouvrage);
    if (!(ouvrage in OUVRAGES)) errors.push('type_ouvrage');
    row.type_ouvrage = ouvrage;
    for (const k of ['surface_m2', 'hauteur_m', 'surface_existante_m2', 'piscine_abri_hauteur_m']) {
        const n = num(f[k]);
        if (Number.isNaN(n)) errors.push(k);
        row[k] = Number.isNaN(n) ? null : n;
    }
    row.terrain_modifie = str(f.terrain_modifie) === 'oui';
    // Parcours LegalPlace (20 nov. 2026) : formule choisie, délai souhaité, payer tout ou une partie.
    row.formule = estFormule(f.formule) ? f.formule : 'pro';
    row.delai_souhaite = DELAIS.includes(str(f.delai_souhaite)) ? str(f.delai_souhaite) : null;
    row.paiement_mode = str(f.paiement_mode) === 'acompte' ? 'acompte' : 'total';
    row.description = str(f.description, 4000) || null;
    return errors.length ? { errors } : { row, errors };
}

type Manifest = { kind: string; name: string; type: string; size: number };

function checkFiles(files: unknown): { list?: Manifest[]; errors: string[] } {
    const errors: string[] = [];
    if (!Array.isArray(files) || files.length > 12) return { errors: ['files'] };
    const list: Manifest[] = [];
    for (const f of files as Record<string, unknown>[]) {
        const m = { kind: str(f?.kind), name: str(f?.name, 200), type: str(f?.type), size: Number(f?.size) };
        if (!(m.kind in FILE_KINDS) || m.kind === 'complement') errors.push('files.kind');
        else if (!ALLOWED_TYPES.includes(m.type)) errors.push(`${m.kind}: format non accepté (JPG, PNG, WEBP, HEIC ou PDF)`);
        else if (!(m.size > 0 && m.size <= MAX_FILE_BYTES)) errors.push(`${m.kind}: 15 Mo maximum`);
        list.push(m);
    }
    // Photos facultatives à la commande : celles qui manquent s'envoient ensuite depuis le lien de suivi.
    return errors.length ? { errors } : { list, errors };
}

Deno.serve(async (req) => {
    await loadSettings();
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
    // Présence des réglages (oui/non, jamais les valeurs) : diagnostic sans accès au tableau de bord.
    if (body.action === 'health') {
        const names = ['DODO_WEBHOOK_SECRET', 'DODO_PRODUCT_DP', 'DODO_PRODUCT_PC', 'DODO_PRODUCT_DP_OFFRE', 'DODO_PRODUCT_PC_OFFRE', 'DODO_API_KEY', 'DODO_PRODUCT_LIBRE', 'N8N_EMAIL_WEBHOOK',
            'ADMIN_EMAIL', 'DODO_CHECKOUT_BASE', 'CALL_URL', 'SITE_URL'];
        return json({
            settings: Object.fromEntries(names.map(n => [n, Boolean(env(n))])),
            site_url: SITE_URL,
            checkout_mode: env('DODO_CHECKOUT_BASE').includes('test.') ? 'test' : 'live',
        });
    }
    const db = admin();

    // Ce que le formulaire peut proposer : les trois formules et l'acompte seulement si le montant libre est réglé.
    if (body.action === 'tarifs') return json({ paiement_libre: paiementLibre(), acompte_cents: ACOMPTE_CENTS });

    // Dernier écran atteint : on enregistre le contact (même s'il ne paie pas) et on lance le chrono de l'offre.
    if (body.action === 'offer_start') {
        const email = str(body.email, 200).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'validation', fields: ['contact_email'] }, 422);
        const utm: Record<string, string> = {};
        for (const [k, val] of Object.entries((body.utm ?? {}) as Record<string, unknown>)) {
            if (/^utm_(source|medium|campaign|content|term)$/.test(k)) utm[k] = str(val, 120);
        }
        const delai = DELAIS.includes(str(body.delai_souhaite)) ? str(body.delai_souhaite) : null;
        await db.from('dossier_clients').upsert({
            email, nom: str(body.nom, 200) || null, entreprise: str(body.entreprise, 200) || null, tel: str(body.tel, 50) || null,
            updated_at: new Date().toISOString(), ...(Object.keys(utm).length ? { utm } : {}), ...(delai ? { delai_souhaite: delai } : {}),
        }, { onConflict: 'email' });
        const o = await offerStatus(db, email, true);
        const t = (str(body.type_dossier) in TYPES ? str(body.type_dossier) : 'dp') as TypeDossier;
        const libre = paiementLibre();
        return json({
            ...o, price_cents: TYPES[t].cents, offer_cents: TYPES[t].offerCents, server_now: new Date().toISOString(),
            // Les formules payables : toutes si le montant libre est réglé dans Dodo, sinon Pro seul.
            paiement_libre: libre, acompte_cents: libre ? ACOMPTE_CENTS : null,
            prix: Object.fromEntries(Object.entries(PRIX[t]).map(([f, c]) => [f, { cents: c, offre_cents: prixOffre(c), payable: libre || f === 'pro' }])),
        });
    }

    if (body.action === 'create') {
        const v = validate((body.fields ?? {}) as Record<string, unknown>);
        const files = checkFiles(body.files);
        const errors = [...v.errors, ...files.errors];
        if (errors.length) return json({ error: 'validation', fields: errors }, 422);

        const utm: Record<string, string> = {};
        for (const [k, val] of Object.entries((body.utm ?? {}) as Record<string, unknown>)) {
            if (/^utm_(source|medium|campaign|content|term)$/.test(k)) utm[k] = str(val, 120);
        }
        const token = randomToken();
        // 2 minutes de marge : le clic a eu lieu à temps, l'envoi des photos peut prendre un moment.
        const offer = await offerStatus(db, String(v.row!.contact_email), false, 120);
        await db.from('dossier_clients').upsert({
            email: v.row!.contact_email, nom: v.row!.contact_nom, entreprise: v.row!.entreprise, tel: v.row!.contact_tel,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        const formule = v.row!.formule as keyof typeof PRIX['dp'];
        if (!paiementLibre() && (formule !== 'pro' || v.row!.paiement_mode !== 'total')) return json({ error: 'validation', fields: ['formule'] }, 422);
        const plein = PRIX[v.row!.type_dossier as TypeDossier][formule];
        const montant = offer.active ? prixOffre(plein) : plein;
        const { data: order, error } = await db.from('orders').insert({
            ...v.row, montant_ht_cents: montant, offre_10min: offer.active, client_token: token, utm,
            acompte_cents: v.row!.paiement_mode === 'acompte' ? ACOMPTE_CENTS : null,
        }).select('id').single();
        if (error || !order) { console.error(error); return json({ error: 'db' }, 500); }

        const uploads = [];
        for (const [i, m] of files.list!.entries()) {
            const path = `${order.id}/${m.kind}-${i + 1}-${safeName(m.name)}`;
            const { data, error: e } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
            if (e || !data) { console.error(e); return json({ error: 'storage' }, 500); }
            uploads.push({ kind: m.kind, path, token: data.token });
        }
        return json({ order_id: order.id, token, uploads, offre_10min: offer.active });
    }

    if (body.action === 'checkout') {
        const orderId = str(body.order_id, 64);
        const token = str(body.token, 128);
        const { data: order } = await db.from('orders').select('*').eq('id', orderId).eq('client_token', token).maybeSingle();
        if (!order) return json({ error: 'not_found' }, 404);
        if (order.status !== 'en_attente_paiement') return json({ error: 'deja_payee' }, 409);

        const { data: objects, error } = await db.storage.from(BUCKET).list(order.id, { limit: 100 });
        if (error) { console.error(error); return json({ error: 'storage' }, 500); }
        const { data: known } = await db.from('order_files').select('storage_path').eq('order_id', order.id);
        const knownPaths = new Set((known ?? []).map(r => r.storage_path));
        const rows = (objects ?? [])
            .map(o => ({ o, path: `${order.id}/${o.name}`, kind: o.name.split('-')[0] }))
            .filter(x => x.kind in FILE_KINDS && !knownPaths.has(x.path))
            .map(x => ({
                order_id: order.id, kind: x.kind, storage_path: x.path,
                filename: x.o.name.replace(/^[a-z_]+-\d+-/, ''),
                content_type: x.o.metadata?.mimetype ?? null, size_bytes: x.o.metadata?.size ?? null,
                uploaded_by: 'formulaire',
            }));
        if (rows.length) {
            const { error: e } = await db.from('order_files').insert(rows);
            if (e) { console.error(e); return json({ error: 'db' }, 500); }
        }
        const acompte = order.paiement_mode === 'acompte';
        const url = await creerPaiement(order, acompte ? (order.acompte_cents ?? ACOMPTE_CENTS) : order.montant_ht_cents,
            acompte ? 'acompte' : 'total', `${SITE_URL}/merci?commande=${order.id}`);
        if (!url) return json({ error: 'paiement_non_configure' }, 503);
        const t = TYPES[order.type_dossier as TypeDossier];
        const product = paiementLibre() ? env('DODO_PRODUCT_LIBRE') : (order.offre_10min ? (t.offerProduct() || t.product()) : t.product());
        await db.from('orders').update({ checkout_product: product }).eq('id', order.id);
        return json({ checkout_url: url });
    }

    return json({ error: 'action' }, 400);
});
