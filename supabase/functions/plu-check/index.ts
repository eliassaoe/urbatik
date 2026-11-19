// plu-check : vérification du PLU AVANT le paiement (décision du gérant, 18 nov. 2026).
// « Si le projet n'est pas viable, on le dit avant même que le client paye. »
//
// Public (formulaire /commande), sans JWT. Autonome (pas de _shared) pour se déployer en un fichier.
//   {action:'start', fields}          → géocode l'adresse, lit le Géoportail de l'Urbanisme (zone, servitudes,
//                                       prescriptions), puis lance l'analyse du règlement. Renvoie {id, status}.
//   {action:'status', id}             → {status, verdict, faits, resultat}
//   {action:'texte', id, token, texte} → appelé par le workflow plu-extract.yml (GitHub Actions) avec le texte
//                                       de la zone, extrait du PDF du règlement (trop lourd pour une Edge Function).
// Verdict : viable | a_verifier | non_viable | inconnu. Un « non_viable » bloque le paiement côté formulaire.
// Le texte d'une zone est gardé en cache (plu_reglement_cache) : la 2e vérification dans la même zone prend ~30 s.
// Secrets : OPENROUTER_API_KEY, GITHUB_DISPATCH_TOKEN (déjà là pour le générateur). Modèle : PLU_MODEL / VISION_MODEL.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
let S: Record<string, string> = {};
const env = (k: string, d = '') => Deno.env.get(k) || S[k] || d;
const GPU = 'https://apicarto.ign.fr/api/gpu';
const FICHIERS = 'https://data.geopf.fr/annexes/gpu/documents';
const MAX_PAR_JOUR = 400;
const SERVITUDES: Record<string, string> = {
    ac1: "abords d'un monument historique : l'Architecte des Bâtiments de France donne son avis (instruction 2 mois au lieu d'1)",
    ac2: "site classé ou inscrit : avis de l'Architecte des Bâtiments de France",
    ac4: "site patrimonial remarquable : avis conforme de l'Architecte des Bâtiments de France (instruction 2 mois)",
    pm1: 'plan de prévention des risques naturels : règles supplémentaires possibles',
    pm3: 'plan de prévention des risques technologiques',
};
const CHAMPS = ['type_dossier', 'type_ouvrage', 'adresse_chantier', 'code_postal', 'ville', 'surface_m2', 'hauteur_m', 'dimensions',
    'distance_limites', 'terrain_modifie', 'materiaux', 'couleurs', 'surface_existante_m2', 'piscine_abri_hauteur_m'];

async function sha256(t: string): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
    return Array.from(h, x => x.toString(16).padStart(2, '0')).join('');
}
async function getJson(url: string, ms = 20000): Promise<any> {
    for (let i = 0; i < 3; i++) {
        try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); if (r.ok) return await r.json(); } catch (_) { /* on réessaie */ }
    }
    throw new Error('injoignable');
}
const props = (r: any) => ((r?.features ?? []) as any[]).map(f => f.properties ?? {});

async function faits(lon: number, lat: number, insee: string) {
    const g = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
    const out: any = { document: null, zone: null, reglement_url: null, rnu: null, servitudes: [], prescriptions: [], abf: false };
    const [m, docs, zones, cc, s1, s2, s3, p1] = await Promise.all([
        getJson(`${GPU}/municipality?insee=${insee}`).catch(() => null),
        getJson(`${GPU}/document?geom=${g}`).catch(() => null),
        getJson(`${GPU}/zone-urba?geom=${g}`).catch(() => null),
        getJson(`${GPU}/secteur-cc?geom=${g}`).catch(() => null),
        getJson(`${GPU}/assiette-sup-s?geom=${g}`).catch(() => null),
        getJson(`${GPU}/assiette-sup-l?geom=${g}`).catch(() => null),
        getJson(`${GPU}/assiette-sup-p?geom=${g}`).catch(() => null),
        getJson(`${GPU}/prescription-surf?geom=${g}`).catch(() => null),
    ]);
    const mm = props(m); out.rnu = !!(mm[0]?.is_rnu);
    const dd = props(docs); if (dd.length) out.document = { type: dd[0].du_type, titre: dd[0].grid_title };
    let zz = props(zones); zz = zz.filter(z => String(z.partition ?? '').startsWith('DU_')).length ? zz.filter(z => String(z.partition ?? '').startsWith('DU_')) : zz;
    if (zz.length) {
        const z = zz[0];
        out.zone = { code: z.libelle, nom: z.libelong, type: z.typezone };
        out.reglement_url = z.urlfic || (z.nomfic && z.gpu_doc_id && z.partition ? `${FICHIERS}/${z.partition}/${z.gpu_doc_id}/${z.nomfic}` : null);
    } else {
        const c = props(cc); if (c.length) out.zone = { code: c[0].libelle, nom: c[0].libelong || 'Secteur de carte communale', type: c[0].typesect };
    }
    const vus = new Set<string>();
    for (const s of [...props(s1), ...props(s2), ...props(s3)]) {
        const t = String(s.suptype ?? '').toLowerCase(), nom = s.nomsuplitt || s.nomass || t.toUpperCase();
        if (!SERVITUDES[t] || vus.has(t + nom)) continue;
        vus.add(t + nom); out.servitudes.push({ type: t, nom, effet: SERVITUDES[t] });
    }
    out.abf = out.servitudes.some((s: any) => ['ac1', 'ac2', 'ac4'].includes(s.type));
    for (const p of props(p1)) { const l = p.libelle || p.txt; if (l && !out.prescriptions.includes(l) && !/stationnement/i.test(l)) out.prescriptions.push(l); }
    return out;
}

function lireJson(rep: any): any {
    const c = rep?.choices?.[0]?.message?.content;
    const t = Array.isArray(c) ? c.map((x: any) => x?.text ?? '').join('') : String(c ?? '');
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j < i) throw new Error('réponse sans JSON');
    return JSON.parse(t.slice(i, j + 1));
}

async function analyser(id: string, texte: string) {
    const { data: c } = await db.from('plu_checks').select('*').eq('id', id).maybeSingle();
    if (!c) return;
    await db.from('plu_checks').update({ status: 'analyse', updated_at: new Date().toISOString() }).eq('id', id);
    const f = c.faits ?? {};
    const consigne = `Tu es instructeur d'autorisations d'urbanisme. Un artisan va commander un dossier de mairie pour ce projet, et paie AVANT qu'on le prépare.
Ta mission : dire honnêtement, avant qu'il paie, si le projet tel qu'il est décrit peut être accepté par la mairie selon le règlement ci-dessous.
${texte ? `Règlement du PLU, zone ${f.zone?.code ?? '?'} (${f.zone?.nom ?? ''}) :` : `Pas de règlement de PLU disponible (${f.rnu ? 'commune au règlement national d\'urbanisme' : 'document non trouvé'}) : applique seulement ce qui est certain.`}
Faits du Géoportail : ${JSON.stringify({ zone: f.zone, document: f.document, servitudes: f.servitudes, prescriptions: f.prescriptions }).slice(0, 1500)}
Projet (saisi par l'artisan, en texte libre parfois) : ${JSON.stringify(c.input).slice(0, 2500)}

Vérifie quand le règlement en parle : le type de construction est-il autorisé dans la zone, hauteur maximale (y compris règles spéciales des annexes, piscines, extensions), recul par rapport à la rue, distance aux limites séparatives, emprise au sol, aspect (toiture, matériaux, couleurs), espaces verts.
Verdict par règle : "conforme", "a_verifier" (donnée manquante ou interprétation), "non_conforme" (le projet dépasse clairement la règle d'après ce qu'il a saisi).
Verdict global :
- "non_viable" seulement si une règle est clairement violée par les chiffres saisis, ou si ce type de construction est interdit dans la zone ;
- "a_verifier" si rien n'est clairement violé mais qu'un point dépend d'une donnée manquante ou d'un avis (ABF) ;
- "viable" si les règles connues sont respectées.
N'invente aucune règle. Pour un verdict "a_verifier", "que_faire" liste ce qu'Urbatik vérifiera en préparant le dossier (pas des devoirs pour l'artisan) ; n'écris jamais de consulter la mairie ou d'attendre avant de payer : c'est Urbatik qui vérifie, et le client est remboursé si le projet ne passe pas.
Écris pour un artisan : phrases courtes, mots simples, chiffres exacts, l'article cité.
Réponds uniquement en JSON :
{"verdict":"viable|a_verifier|non_viable",
 "titre":"une phrase qui résume, ex. « Votre préau dépasse la hauteur autorisée »",
 "explication":"2 à 4 phrases : pourquoi, avec la règle et le chiffre du projet",
 "que_faire":["action concrète 1, ex. « ramener la hauteur à 3 m à l'égout »","action 2"],
 "regles":[{"theme":"destination|hauteur|recul_voie|limites|emprise|aspect|espaces_verts|autre","article":"…","regle":"…","projet":"…","verdict":"conforme|a_verifier|non_conforme"}]}
${texte ? `\nRÈGLEMENT (extrait) :\n${texte.slice(0, 60000)}` : ''}`;
    try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', signal: AbortSignal.timeout(120000),
            headers: { Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json', 'X-Title': 'Urbatik' },
            body: JSON.stringify({ model: env('PLU_MODEL', env('VISION_MODEL', 'anthropic/claude-sonnet-4.5')), max_tokens: 6000, messages: [{ role: 'user', content: consigne }] }),
        });
        const rep = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(rep?.error?.message ?? `openrouter ${r.status}`);
        const res = lireJson(rep);
        const regles = Array.isArray(res.regles) ? res.regles : [];
        let verdict = ['viable', 'a_verifier', 'non_viable'].includes(res.verdict) ? res.verdict : 'a_verifier';
        if (regles.some((x: any) => x.verdict === 'non_conforme')) verdict = 'non_viable';
        if (verdict === 'viable' && (f.abf || regles.some((x: any) => x.verdict === 'a_verifier'))) verdict = 'a_verifier';
        await db.from('plu_checks').update({ status: 'pret', verdict, resultat: res, updated_at: new Date().toISOString() }).eq('id', id);
    } catch (e) {
        await db.from('plu_checks').update({ status: 'erreur', verdict: 'inconnu', erreur: String((e as Error).message).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id);
    }
}

function vue(c: any) {
    const f = c.faits ?? {};
    return {
        id: c.id, status: c.status, verdict: c.verdict,
        faits: { zone: f.zone, document: f.document, rnu: f.rnu, abf: f.abf, servitudes: f.servitudes, prescriptions: (f.prescriptions ?? []).slice(0, 6), reglement_url: f.reglement_url },
        resultat: c.resultat ? { titre: c.resultat.titre, explication: c.resultat.explication, que_faire: c.resultat.que_faire, regles: c.resultat.regles } : null,
    };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
    const { data: rows } = await db.from('dossier_settings').select('key, value');
    S = Object.fromEntries((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

    if (body.action === 'status') {
        const { data: c } = await db.from('plu_checks').select('*').eq('id', String(body.id ?? '')).maybeSingle();
        if (!c) return json({ error: 'not_found' }, 404);
        // Extraction bloquée (workflow en panne) : au bout de 4 min on rend la main, sans bloquer la commande.
        if (['en_cours', 'extraction', 'analyse'].includes(c.status) && Date.now() - new Date(c.updated_at).getTime() > 240_000) {
            await db.from('plu_checks').update({ status: 'erreur', verdict: 'inconnu', erreur: 'délai dépassé' }).eq('id', c.id);
            c.status = 'erreur'; c.verdict = 'inconnu';
        }
        return json(vue(c));
    }

    if (body.action === 'texte') {
        const { data: c } = await db.from('plu_checks').select('*').eq('id', String(body.id ?? '')).maybeSingle();
        if (!c || !c.token_hash || typeof body.token !== 'string' || (await sha256(body.token)) !== c.token_hash) return json({ error: 'not_found' }, 404);
        const texte = String(body.texte ?? '').slice(0, 80000);
        if (texte.length > 500 && c.cache_key) await db.from('plu_reglement_cache').upsert({ cache_key: c.cache_key, texte });
        // @ts-ignore EdgeRuntime existe sur Supabase
        EdgeRuntime.waitUntil(analyser(c.id, texte.length > 500 ? texte : ''));
        return json({ ok: true });
    }

    if (body.action === 'start') {
        const input: Record<string, string> = {};
        for (const k of CHAMPS) input[k] = String(body.fields?.[k] ?? '').trim().slice(0, 400);
        if (!input.adresse_chantier || !/^\d{5}$/.test(input.code_postal) || !input.type_ouvrage) return json({ error: 'champs' }, 422);
        const hash = await sha256(JSON.stringify(input));
        const { data: deja } = await db.from('plu_checks').select('*').eq('input_hash', hash).gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
            .neq('status', 'erreur').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (deja) return json(vue(deja));
        const { count } = await db.from('plu_checks').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
        if ((count ?? 0) >= MAX_PAR_JOUR) return json({ status: 'indisponible', verdict: 'inconnu' });

        let geo: any;
        try { geo = await getJson(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(`${input.adresse_chantier} ${input.code_postal} ${input.ville}`)}&limit=1`); }
        catch { return json({ status: 'indisponible', verdict: 'inconnu' }); }
        const ft = geo?.features?.[0];
        if (!ft || (ft.properties?.score ?? 0) < 0.45) {
            const { data: c } = await db.from('plu_checks').insert({ input_hash: hash, input, status: 'pret', verdict: 'inconnu', erreur: 'adresse introuvable' }).select('*').single();
            return json({ ...vue(c), adresse_introuvable: true });
        }
        const [lon, lat] = ft.geometry.coordinates;
        const fx = await faits(lon, lat, ft.properties.citycode);
        const cle = fx.reglement_url && fx.zone?.code ? `${fx.reglement_url}|${fx.zone.code}` : null;
        const jeton = crypto.randomUUID() + crypto.randomUUID();
        const { data: c, error } = await db.from('plu_checks').insert({
            input_hash: hash, input, faits: fx, cache_key: cle, token_hash: await sha256(jeton), status: 'en_cours',
        }).select('*').single();
        if (error || !c) return json({ error: 'db' }, 500);

        const { data: cache } = cle ? await db.from('plu_reglement_cache').select('texte').eq('cache_key', cle).maybeSingle() : { data: null };
        if (cache?.texte || !cle) {
            // @ts-ignore
            EdgeRuntime.waitUntil(analyser(c.id, cache?.texte ?? ''));
        } else {
            await db.from('plu_checks').update({ status: 'extraction' }).eq('id', c.id);
            const gh = env('GITHUB_DISPATCH_TOKEN');
            const r = gh ? await fetch(`https://api.github.com/repos/${env('GITHUB_REPO', 'eliassaoe/urbatik')}/dispatches`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${gh}`, Accept: 'application/vnd.github+json', 'User-Agent': 'urbatik', 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_type: 'plu-extract', client_payload: { check_id: c.id, token: jeton, url: fx.reglement_url, zone: fx.zone.code } }),
            }).catch(() => null) : null;
            if (!r || !r.ok) {
                // @ts-ignore
                EdgeRuntime.waitUntil(analyser(c.id, ''));
            }
        }
        return json(vue({ ...c, status: cache?.texte || !cle ? 'analyse' : 'extraction' }));
    }

    return json({ error: 'action' }, 400);
});
