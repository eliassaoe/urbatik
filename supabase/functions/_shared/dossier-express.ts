// Code commun aux Edge Functions de Dossier Express (create-order, dodo-webhook, client-order).
//
// Secrets (Supabase → Edge Functions → Secrets), jamais dans ce dépôt public :
//   DODO_WEBHOOK_SECRET   whsec_… (Dodo → Développeur → Webhooks)
//   DODO_PRODUCT_DP       id du produit « Déclaration préalable – Dossier Express » (pdt_…)
//   DODO_PRODUCT_PC       id du produit « Permis de construire – Dossier Express » (pdt_…)
//   ADMIN_EMAIL           votre adresse : notifications de commande et de fichier
//   N8N_EMAIL_WEBHOOK     webhook n8n « Dossier Express – emails » : envoie l'email avec le compte SMTP
//                         de n8n. Pas de Resend.
// Seul DODO_WEBHOOK_SECRET doit être un secret Supabase. Les autres réglages (ids produits, adresses,
// mode de paiement, webhook n8n) peuvent aussi vivre dans la table privée `dossier_settings`
// (RLS active, aucun accès anon) : un secret Supabase du même nom l'emporte toujours.
// Facultatifs :
//   DODO_CHECKOUT_BASE    https://checkout.dodopayments.com/buy/ (test : https://test.checkout.dodopayments.com/buy/)
//   SITE_URL              https://urbatik.com
//   CALL_URL              lien WhatsApp du conseiller (wa.me), plus Calendly depuis le 17 nov. 2026
// Générateur de dossiers (secrets Supabase) :
//   OPENROUTER_API_KEY    lecture des photos de façade + photomontage DP6 (fonction dossier-ia)
//   GITHUB_DISPATCH_TOKEN jeton GitHub (droit « Contents: write » sur eliassaoe/urbatik seulement)
//                         qui lance le workflow generer-dossier.yml
// Facultatifs (dossier_settings) : VISION_MODEL, IMAGE_MODEL, GITHUB_REPO (eliassaoe/urbatik)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

let SETTINGS: Record<string, string> = {};

export const env = (k: string, fallback = ''): string => Deno.env.get(k) || SETTINGS[k] || fallback;

export let SITE_URL = 'https://urbatik.com';
export let CALL_URL = 'https://wa.me/33626344475?text=Bonjour%2C%20j%27ai%20une%20question%20sur%20un%20dossier%20de%20mairie.';

// À appeler au début de chaque requête : lit `dossier_settings` (clé service, la RLS bloque le reste).
export async function loadSettings(): Promise<void> {
    try {
        const { data, error } = await admin().from('dossier_settings').select('key, value');
        if (error) console.error('dossier_settings illisible', error.message);
        SETTINGS = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    } catch (e) {
        console.error('dossier_settings illisible', e);
    }
    SITE_URL = env('SITE_URL', 'https://urbatik.com').replace(/\/$/, '');
    CALL_URL = env('CALL_URL', 'https://wa.me/33626344475?text=Bonjour%2C%20j%27ai%20une%20question%20sur%20un%20dossier%20de%20mairie.');
}
export const DELAI = "72 h (jours ouvrés) après réception de toutes les informations";
// Suivi jusqu'à l'accord de la mairie (18 nov. 2026, docs/suivi-mairie.md) : après la livraison, la page /suivi
// demande « La mairie a accepté ? Oui / Non ». Sans réponse, le dossier est considéré accepté au bout de
// PRESUME_JOURS et clos ; « Non » reste possible pendant NON_POSSIBLE_JOURS et remet le dossier en travail.
export const PRESUME_JOURS = 30;
export const RAPPEL_JOURS = 21;
export const NON_POSSIBLE_JOURS = 180;
export const SUIVI_MAIRIE = "On suit votre dossier jusqu'à l'accord de la mairie. Si elle demande une pièce ou refuse, on retravaille le dossier sans frais.";
export const BUCKET = 'dossiers';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export type TypeDossier = 'dp' | 'pc' | 'a_determiner';

// « Je ne sais pas » est facturé comme une déclaration préalable ; le complément
// d'un permis éventuel est facturé à la main.
// Prix HT : 249 € / 390 € (permis baissé de 790 à 390 € le 18 nov. 2026, aligné sur le bas du marché). Offre « 10 minutes » : -30 % sur le premier dossier
// (174 € / 273 €), via des produits Dodo dédiés pour qu'aucun code ne soit à saisir.
export const TYPES: Record<TypeDossier, { label: string; cents: number; offerCents: number; product: () => string; offerProduct: () => string }> = {
    dp: { label: 'Déclaration préalable', cents: 24900, offerCents: 17400, product: () => env('DODO_PRODUCT_DP'), offerProduct: () => env('DODO_PRODUCT_DP_OFFRE') },
    pc: { label: 'Permis de construire (maison individuelle)', cents: 39000, offerCents: 27300, product: () => env('DODO_PRODUCT_PC'), offerProduct: () => env('DODO_PRODUCT_PC_OFFRE') },
    a_determiner: { label: 'À déterminer (facturé comme une déclaration préalable)', cents: 24900, offerCents: 17400, product: () => env('DODO_PRODUCT_DP'), offerProduct: () => env('DODO_PRODUCT_DP_OFFRE') },
};

// Trois formules, comme LegalPlace (20 nov. 2026, docs/parcours-legalplace.md). « pro » est l'offre
// historique (249 € / 390 €) et la seule payable tant que le paiement à montant libre n'est pas réglé.
export type Formule = 'essentiel' | 'pro' | 'premium';
export const FORMULES: Record<Formule, { label: string; inclus: string[] }> = {
    essentiel: { label: 'Essentiel', inclus: ['Dossier complet : Cerfa, plans, photomontage, notice', 'Livré en 72 h', 'Vous le déposez vous-même en mairie'] },
    pro: { label: 'Pro', inclus: ['Dossier complet : Cerfa, plans, photomontage, notice', 'Relu par un professionnel avant envoi', "Suivi jusqu'à l'accord de la mairie", 'Garantie anti-refus : on retravaille sans frais'] },
    premium: { label: 'Premium', inclus: ['Tout ce qui est dans Pro', 'Traitement prioritaire : livré en 48 h', 'Appel de cadrage avec votre conseiller', 'Modifications illimitées jusqu\'à l\'accord'] },
};
export const PRIX: Record<TypeDossier, Record<Formule, number>> = {
    dp: { essentiel: 19900, pro: 24900, premium: 34900 },
    pc: { essentiel: 32900, pro: 39000, premium: 49000 },
    a_determiner: { essentiel: 19900, pro: 24900, premium: 34900 },
};
// « Payer maintenant » : -30 % pendant l'offre premier dossier (174 € / 273 € en Pro, comme avant).
export const prixOffre = (cents: number) => Math.round(cents * 0.7 / 100) * 100;
export const ACOMPTE_CENTS = 4900;
export const estFormule = (f: unknown): f is Formule => typeof f === 'string' && f in FORMULES;

// Montant libre (formules Essentiel/Premium, acompte, solde) : un produit Dodo « Pay What You Want »
// (DODO_PRODUCT_LIBRE) et une clé API (DODO_API_KEY, secret Supabase). Sans eux : produits fixes, Pro seul.
export const paiementLibre = () => !!(env('DODO_API_KEY') && env('DODO_PRODUCT_LIBRE'));

export async function creerPaiement(order: Record<string, any>, cents: number, paiement: 'total' | 'acompte' | 'solde', retour: string): Promise<string | null> {
    const meta: Record<string, string> = { source: 'dossier_express', order_id: String(order.id), type_dossier: String(order.type_dossier), paiement };
    if (paiementLibre()) {
        const base = env('DODO_API_BASE', env('DODO_CHECKOUT_BASE').includes('test.') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com');
        const r = await fetch(`${base.replace(/\/$/, '')}/checkouts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env('DODO_API_KEY')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_cart: [{ product_id: env('DODO_PRODUCT_LIBRE'), quantity: 1, amount: cents }],
                customer: { email: String(order.contact_email), name: String(order.contact_nom) },
                return_url: retour, metadata: meta,
            }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.checkout_url) return d.checkout_url;
        console.error('Dodo checkouts', r.status, JSON.stringify(d).slice(0, 300));
        return null;
    }
    // Repli : liens des produits fixes, seulement pour Pro payé en une fois.
    if (paiement !== 'total' || (order.formule ?? 'pro') !== 'pro') return null;
    const t = TYPES[order.type_dossier as TypeDossier];
    const product = order.offre_10min ? (t.offerProduct() || t.product()) : t.product();
    if (!product) return null;
    const u = new URL(env('DODO_CHECKOUT_BASE', 'https://checkout.dodopayments.com/buy/').replace(/\/?$/, '/') + product);
    u.searchParams.set('quantity', '1');
    u.searchParams.set('email', String(order.contact_email));
    u.searchParams.set('fullName', String(order.contact_nom));
    u.searchParams.set('redirect_url', retour);
    for (const [k, v] of Object.entries(meta)) u.searchParams.set(`metadata_${k}`, v);
    return u.toString();
}

export const OFFER_MINUTES = 10;

// Offre accordée une fois par email, à quelqu'un qui n'a jamais payé, pendant OFFER_MINUTES
// à partir du premier passage au dernier écran (horodaté ici, pas dans le navigateur).
export async function offerStatus(db: SupabaseClient, email: string, start = false, graceSeconds = 0):
    Promise<{ eligible: boolean; active: boolean; expires_at: string | null }> {
    const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
        .eq('contact_email', email).not('status', 'in', '(en_attente_paiement,annulee)');
    if ((count ?? 0) > 0) return { eligible: false, active: false, expires_at: null };
    let { data: c } = await db.from('dossier_clients').select('offer_started_at').eq('email', email).maybeSingle();
    if (start && !c?.offer_started_at) {
        const now = new Date().toISOString();
        await db.from('dossier_clients').upsert({ email, offer_started_at: now, updated_at: now }, { onConflict: 'email' });
        c = { offer_started_at: now };
    }
    if (!c?.offer_started_at) return { eligible: true, active: false, expires_at: null };
    const end = new Date(c.offer_started_at).getTime() + OFFER_MINUTES * 60_000;
    return { eligible: true, active: Date.now() <= end + graceSeconds * 1000, expires_at: new Date(end).toISOString() };
}

export const OUVRAGES: Record<string, string> = {
    veranda: 'Véranda', extension: 'Extension', pergola: 'Pergola', carport: 'Carport',
    abri_jardin: 'Abri de jardin', piscine: 'Piscine', solaire_toiture: 'Solaire en toiture',
    solaire_sol: 'Solaire au sol', menuiseries: 'Menuiseries', cloture: 'Clôture',
};

export const FILE_KINDS: Record<string, string> = {
    photo_facade: 'Photo de la façade concernée',
    photo_ensemble: "Photo de la vue d'ensemble",
    photo_rue: 'Photo de la vue depuis la rue',
    plan_ou_devis: 'Plan, croquis ou devis',
    complement: 'Document complémentaire',
    courrier_mairie: 'Courrier de la mairie',
};

export const REQUIRED_PHOTOS = ['photo_facade', 'photo_ensemble', 'photo_rue'];

// Photos en plus pour que le générateur dessine les 4 façades et l'insertion paysagère.
// « Façade avant » = celle qu'on voit depuis la rue ; gauche / droite = vues depuis la rue.
export const FACADE_PHOTOS: Record<string, string> = {
    facade_avant: 'Photo de la façade avant (côté rue), de face',
    facade_arriere: 'Photo de la façade arrière, de face',
    facade_gauche: 'Photo de la façade gauche (vue depuis la rue), de face',
    facade_droite: 'Photo de la façade droite (vue depuis la rue), de face',
    photo_emplacement: "Photo de près de l'emplacement exact des travaux",
};
Object.assign(FILE_KINDS, FACADE_PHOTOS);

// Fiche technique remplie par l'artisan après la commande (page /suivi) : tout ce dont le générateur
// de dossiers a besoin pour dessiner juste (docs/generateur/donnees-necessaires.md). Une seule source :
// la page /suivi affiche ces champs, le serveur les valide avec, le générateur les lit.
type Champ = {
    k: string; label: string; type: 'num' | 'choix' | 'texte'; unite?: string; requis?: boolean; aide?: string;
    options?: [string, string][]; min?: number; max?: number; si?: Record<string, string[]>; ouvrages?: string[];
};
const ACCOLABLE = ['veranda', 'pergola', 'extension', 'carport', 'abri_jardin'];
const VOLUME = [...ACCOLABLE, 'solaire_sol'];
const COTES: [string, string][] = [['avant', 'Avant (côté rue)'], ['arriere', 'Arrière'], ['gauche', 'Gauche (vue depuis la rue)'], ['droite', 'Droite (vue depuis la rue)']];
export const FICHE: { titre: string; aide: string; champs: Champ[] }[] = [
    // Formulaire court (19 nov. 2026) : ces infos ne sont plus demandées avant le paiement. client-order les recopie
    // dans les colonnes de la commande (ORDER_FROM_FICHE) pour que le générateur et l'admin les lisent comme avant.
    {
        titre: 'Le chantier', aide: 'Les infos qui figureront sur la demande en mairie.', champs: [
            { k: 'nom_client_final', label: 'Nom et prénom du propriétaire (votre client, il signe la demande)', type: 'texte', requis: true },
            { k: 'surface_m2', label: 'Surface au sol créée', type: 'num', unite: 'm²', requis: true, min: 0.5, max: 2000 },
            { k: 'hauteur_m', label: 'Hauteur maximale', type: 'num', unite: 'm', requis: true, min: 0.2, max: 20 },
            { k: 'materiaux', label: 'Matériaux', type: 'texte', requis: true, aide: 'Ex. : aluminium, toiture vitrée' },
            { k: 'couleurs', label: 'Couleurs', type: 'texte', requis: true, aide: 'Ex. : gris anthracite RAL 7016' },
            { k: 'terrain_modifie', label: 'Le terrain sera-t-il terrassé ou remblayé ?', type: 'choix', requis: true, options: [['non', 'Non'], ['oui', 'Oui']] },
        ],
    },
    {
        titre: 'Le projet', aide: 'Les mesures extérieures, en mètres. Elles seront dessinées telles quelles sur les plans.', champs: [
            { k: 'largeur_m', label: 'Largeur', type: 'num', unite: 'm', requis: true, min: 0.3, max: 60, ouvrages: VOLUME },
            { k: 'profondeur_m', label: 'Profondeur (avancée)', type: 'num', unite: 'm', requis: true, min: 0.3, max: 60, ouvrages: VOLUME },
            { k: 'toit', label: 'Forme du toit', type: 'choix', requis: true, ouvrages: ACCOLABLE,
              options: [['plat', 'Toit plat'], ['une_pente', 'Une pente'], ['deux_pentes', 'Deux pentes']] },
            { k: 'hauteur_egout_m', label: 'Hauteur au point bas du toit', type: 'num', unite: 'm', requis: true, min: 0.5, max: 12,
              si: { toit: ['une_pente', 'deux_pentes'] } },
            { k: 'implantation', label: 'Où se place-t-il ?', type: 'choix', requis: true, ouvrages: [...VOLUME, 'piscine'],
              options: [['accole', 'Accolé à la maison'], ['isole', 'Isolé dans le jardin']] },
            { k: 'facade_accroche', label: 'Contre quelle façade de la maison ?', type: 'choix', requis: true, options: COTES, si: { implantation: ['accole'] } },
            { k: 'position_sur_facade', label: "Position le long de cette façade", type: 'choix', requis: true, si: { implantation: ['accole'] },
              options: [['gauche', "Calé à l'angle gauche"], ['centre', 'Centré'], ['droite', "Calé à l'angle droit"], ['toute', 'Sur toute la longueur']] },
            { k: 'distance_maison_m', label: 'Distance à la maison', type: 'num', unite: 'm', requis: true, min: 0, max: 200, si: { implantation: ['isole'] } },
            // piscine
            { k: 'bassin_longueur_m', label: 'Longueur du bassin', type: 'num', unite: 'm', requis: true, min: 1, max: 30, ouvrages: ['piscine'] },
            { k: 'bassin_largeur_m', label: 'Largeur du bassin', type: 'num', unite: 'm', requis: true, min: 1, max: 20, ouvrages: ['piscine'] },
            { k: 'bassin_profondeur_m', label: 'Profondeur maximale', type: 'num', unite: 'm', requis: true, min: 0.5, max: 4, ouvrages: ['piscine'] },
            { k: 'plage_m', label: 'Largeur de la plage autour (margelle comprise)', type: 'num', unite: 'm', requis: true, min: 0, max: 10, ouvrages: ['piscine'] },
            { k: 'local_technique', label: 'Local technique', type: 'choix', requis: true, ouvrages: ['piscine'],
              options: [['non', 'Non'], ['enterre', 'Oui, enterré'], ['hors_sol', 'Oui, hors sol (abri)']] },
            // clôture
            { k: 'cloture_longueur_m', label: 'Longueur totale de clôture', type: 'num', unite: 'm', requis: true, min: 1, max: 1000, ouvrages: ['cloture'] },
            { k: 'cloture_hauteur_m', label: 'Hauteur', type: 'num', unite: 'm', requis: true, min: 0.3, max: 4, ouvrages: ['cloture'] },
            { k: 'cloture_limites', label: 'Sur quelles limites ?', type: 'texte', requis: true, ouvrages: ['cloture'], aide: 'Ex. : limite côté rue et limite gauche' },
            { k: 'portail', label: 'Portail ou portillon', type: 'texte', ouvrages: ['cloture'], aide: 'Largeur et hauteur, ou « non »' },
            // solaire
            { k: 'panneaux_nombre', label: 'Nombre de panneaux', type: 'num', requis: true, min: 1, max: 500, ouvrages: ['solaire_toiture', 'solaire_sol'] },
            { k: 'panneaux_surface_m2', label: 'Surface totale des panneaux', type: 'num', unite: 'm²', requis: true, min: 1, max: 2000, ouvrages: ['solaire_toiture', 'solaire_sol'] },
            { k: 'pan_toiture', label: 'Sur quel pan du toit ?', type: 'choix', requis: true, options: COTES, ouvrages: ['solaire_toiture'] },
            // menuiseries
            { k: 'menuiseries_detail', label: 'Ouvertures modifiées ou créées', type: 'texte', requis: true, ouvrages: ['menuiseries'],
              aide: 'Pour chacune : façade, largeur × hauteur avant et après, matériau, couleur' },
        ],
    },
    {
        titre: 'Distances aux limites de propriété', aide: "Depuis le bord de l'ouvrage jusqu'à la limite. 0 si en limite. Laissez vide si plus de 15 m.", champs: [
            { k: 'dist_avant_m', label: 'Limite côté rue', type: 'num', unite: 'm', min: 0, max: 15 },
            { k: 'dist_arriere_m', label: 'Limite du fond', type: 'num', unite: 'm', min: 0, max: 15 },
            { k: 'dist_gauche_m', label: 'Limite gauche (vue depuis la rue)', type: 'num', unite: 'm', min: 0, max: 15 },
            { k: 'dist_droite_m', label: 'Limite droite (vue depuis la rue)', type: 'num', unite: 'm', min: 0, max: 15 },
        ],
    },
    {
        titre: 'Ouvertures du projet', aide: 'Portes, baies, passages. Laissez vide s\'il n\'y en a pas.', champs: [
            { k: 'ouverture_1', label: 'Ouverture 1', type: 'texte', ouvrages: ACCOLABLE, aide: 'Ex. : 1,80 × 2,10 m, face côté jardin, sans porte' },
            { k: 'ouverture_2', label: 'Ouverture 2', type: 'texte', ouvrages: ACCOLABLE },
        ],
    },
    {
        titre: 'La maison existante', aide: "Pour dessiner la coupe et les façades. Sans les hauteurs, on les déduit du nombre de niveaux et des photos.", champs: [
            { k: 'niveaux', label: 'Niveaux', type: 'choix', requis: true, options: [['rdc', 'Plain-pied'], ['r1', 'Un étage'], ['r2', 'Deux étages'], ['combles', 'Plain-pied + combles aménagés']] },
            { k: 'maison_toiture', label: 'Toiture de la maison', type: 'texte', requis: true, aide: 'Matériau et couleur. Ex. : tuiles rouges' },
            { k: 'maison_aspect', label: 'Murs et fenêtres de la maison', type: 'texte', requis: true, aide: 'Ex. : enduit beige, fenêtres PVC blanc' },
            { k: 'maison_gouttiere_m', label: 'Hauteur à la gouttière, si vous la connaissez', type: 'num', unite: 'm', min: 1.5, max: 15 },
            { k: 'maison_faitage_m', label: 'Hauteur au faîtage, si vous la connaissez', type: 'num', unite: 'm', min: 1.5, max: 20 },
        ],
    },
    {
        titre: 'Le terrain', aide: '', champs: [
            { k: 'surface_terrain_m2', label: 'Surface du terrain, si vous la connaissez', type: 'num', unite: 'm²', min: 20, max: 1000000 },
            { k: 'terrain_pente', label: 'Le terrain est-il en pente ?', type: 'choix', requis: true, options: [['non', 'Non, plat'], ['legere', 'Légère pente'], ['forte', 'Forte pente']] },
            { k: 'arbres_abattus', label: 'Des arbres seront-ils abattus ?', type: 'choix', requis: true, options: [['non', 'Non'], ['oui', 'Oui']] },
            { k: 'assainissement', label: 'Assainissement', type: 'choix', requis: true, ouvrages: ['extension'], options: [['collectif', "Tout-à-l'égout"], ['individuel', 'Fosse / assainissement individuel'], ['ne_sait_pas', 'Je ne sais pas']] },
            { k: 'eaux_pluviales', label: 'Eaux de pluie du projet', type: 'choix', ouvrages: [...ACCOLABLE, 'piscine'],
              options: [['reseau', 'Raccordées au réseau existant'], ['infiltration', 'Infiltrées sur le terrain'], ['cuve', 'Récupérées dans une cuve']] },
            { k: 'facades_inaccessibles', label: 'Façades impossibles à photographier', type: 'texte',
              aide: 'Ex. : « gauche » si la maison est collée au voisin. Laissez vide sinon.' },
        ],
    },
];

function champActif(c: Champ, ouvrage: string, f: Record<string, unknown>): boolean {
    if (c.ouvrages && !c.ouvrages.includes(ouvrage)) return false;
    if (c.si) for (const [k, vals] of Object.entries(c.si)) if (!vals.includes(String(f[k] ?? ''))) return false;
    return true;
}

// Nettoie et valide une fiche reçue de la page /suivi. Renvoie la fiche propre et les erreurs par champ.
export function validerFiche(ouvrage: string, brut: Record<string, unknown>): { fiche: Record<string, unknown>; erreurs: Record<string, string> } {
    const fiche: Record<string, unknown> = {}; const erreurs: Record<string, string> = {};
    for (const c of FICHE.flatMap(s => s.champs)) {
        const v = brut?.[c.k];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        if (c.type === 'num') {
            const n = Number(String(v).replace(',', '.'));
            if (!Number.isFinite(n) || (c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max)) { erreurs[c.k] = 'valeur'; continue; }
            fiche[c.k] = n;
        } else if (c.type === 'choix') {
            if (!c.options!.some(o => o[0] === v)) { erreurs[c.k] = 'choix'; continue; }
            fiche[c.k] = v;
        } else fiche[c.k] = String(v).trim().slice(0, 300);
    }
    if (typeof fiche.maison_gouttiere_m === 'number' && typeof fiche.maison_faitage_m === 'number' && fiche.maison_gouttiere_m > fiche.maison_faitage_m) erreurs.maison_gouttiere_m = 'superieure';
    return { fiche, erreurs };
}

export function ficheManquants(ouvrage: string, fiche: Record<string, unknown> | null): string[] {
    const f = fiche ?? {};
    return FICHE.flatMap(s => s.champs).filter(c => c.requis && champActif(c, ouvrage, f) && (f[c.k] === undefined || f[c.k] === '')).map(c => c.label);
}

// Champs de la fiche recopiés dans les colonnes de la commande (le générateur lit ces colonnes).
export function orderFromFiche(f: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const k of ['nom_client_final', 'materiaux', 'couleurs']) if (typeof f[k] === 'string' && f[k]) o[k] = f[k];
    for (const k of ['surface_m2', 'hauteur_m']) if (typeof f[k] === 'number') o[k] = f[k];
    if (f.terrain_modifie === 'oui' || f.terrain_modifie === 'non') o.terrain_modifie = f.terrain_modifie === 'oui';
    if (typeof f.largeur_m === 'number' && typeof f.profondeur_m === 'number') o.dimensions = `${f.largeur_m} m × ${f.profondeur_m} m`;
    const d = (['dist_avant_m', 'dist_arriere_m', 'dist_gauche_m', 'dist_droite_m'] as const)
        .filter(k => typeof f[k] === 'number').map(k => `${k.slice(5, -2)} ${f[k]} m`);
    if (d.length) o.distance_limites = d.join(', ');
    return o;
}

// Fiche vue avec les valeurs déjà connues de la commande (commandes passées avec l'ancien formulaire long).
export function ficheAvecCommande(order: Record<string, unknown>): Record<string, unknown> {
    const f: Record<string, unknown> = {};
    for (const k of ['nom_client_final', 'materiaux', 'couleurs']) if (typeof order[k] === 'string' && order[k]) f[k] = order[k];
    for (const k of ['surface_m2', 'hauteur_m']) if (order[k] !== null && order[k] !== undefined && order[k] !== '') f[k] = Number(order[k]);
    if (order.surface_m2 !== null && order.surface_m2 !== undefined) f.terrain_modifie = order.terrain_modifie ? 'oui' : 'non';
    return { ...f, ...((order.fiche_technique ?? {}) as Record<string, unknown>) };
}

export const FICHE_LIBELLE = 'Fiche technique du projet (mesures, implantation, maison existante)';

// Façades à photographier : les 4, sauf celles déclarées inaccessibles.
// La façade concernée par les travaux est déjà la photo « façade » de la commande, et sert aussi de vue de près (DP7).
export function facadesAttendues(fiche: Record<string, unknown> | null): string[] {
    const inacc = String(fiche?.facades_inaccessibles ?? '').toLowerCase();
    const deja = fiche?.implantation === 'accole' ? `facade_${fiche?.facade_accroche}` : '';
    return ['facade_avant', 'facade_arriere', 'facade_gauche', 'facade_droite']
        .filter(k => k !== deja && !inacc.includes(k.slice(7).replace('arriere', 'arri')));
}

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export function admin(): SupabaseClient {
    return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
}

export function euros(cents: number): string {
    return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}

export function esc(s: unknown): string {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function randomToken(): string {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function safeName(name: string): string {
    const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-');
    return base.replace(/^-+|-+$/g, '').slice(-80) || 'fichier';
}

// Ce qui manque encore pour commencer le dossier.
export function missingItems(order: Record<string, unknown>, kinds: string[]): string[] {
    const out: string[] = [];
    for (const k of REQUIRED_PHOTOS) if (!kinds.includes(k)) out.push(FILE_KINDS[k]);
    // Fiche technique et photos des façades : demandées après la commande, nécessaires au générateur.
    const fiche = ficheAvecCommande(order);
    if (ficheManquants(String(order.type_ouvrage ?? ''), fiche).length) out.push(FICHE_LIBELLE);
    for (const k of facadesAttendues(fiche)) if (!kinds.includes(k)) out.push(FILE_KINDS[k]);
    if (order.type_dossier !== 'dp' && (order.surface_existante_m2 === null || order.surface_existante_m2 === undefined)) {
        out.push('Surface de plancher actuelle de la maison (m², proche de la surface habitable) : elle décide si un architecte est obligatoire');
    }
    if (order.type_ouvrage === 'piscine' && (order.piscine_abri_hauteur_m === null || order.piscine_abri_hauteur_m === undefined)) {
        out.push("Pour la piscine : hauteur de l'abri s'il y en a un (sinon, répondez « pas d'abri »)");
    }
    return out;
}

export function suiviUrl(token: string): string {
    return `${SITE_URL}/suivi?token=${token}`;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
    const hook = env('N8N_EMAIL_WEBHOOK');
    if (!hook || !to) {
        console.error('email non envoyé : N8N_EMAIL_WEBHOOK ou destinataire manquant', { subject });
        return false;
    }
    try {
        const res = await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, html, text, from_name: env('BRAND', 'Urbatik') }),
        });
        if (!res.ok) console.error('n8n a refusé l’email', res.status, await res.text());
        return res.ok;
    } catch (e) {
        console.error('échec envoi email', e);
        return false;
    }
}

export function emailShell(inner: string): string {
    return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f6f2;font:16px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1d1f1e">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:18px;letter-spacing:-.02em;margin-bottom:16px">${esc(env('BRAND', 'Urbatik'))}</div>
<div style="background:#fff;border:1px solid #e3e1da;border-radius:12px;padding:20px">${inner}</div>
</div></body></html>`;
}

// Vérification de signature Standard Webhooks (spécification suivie par Dodo) :
// HMAC-SHA256 de `{webhook-id}.{webhook-timestamp}.{corps brut}`, encodé en base64,
// avec la partie base64 du secret `whsec_…`. L'en-tête peut contenir plusieurs
// signatures `v1,<sig>` séparées par des espaces (rotation de clé).
export async function verifyStandardWebhook(
    headers: Headers, rawBody: string, secret: string, nowSeconds = Date.now() / 1000,
): Promise<{ ok: boolean; reason?: string; id?: string }> {
    if (!secret) return { ok: false, reason: 'DODO_WEBHOOK_SECRET absent' };
    const id = headers.get('webhook-id');
    const ts = headers.get('webhook-timestamp');
    const sig = headers.get('webhook-signature');
    if (!id || !ts || !sig) return { ok: false, reason: 'en-têtes de signature absents' };
    const age = Math.abs(nowSeconds - Number(ts));
    if (!Number.isFinite(age) || age > 300) return { ok: false, reason: 'horodatage hors tolérance' };

    const keyBytes = Uint8Array.from(atob(secret.startsWith('whsec_') ? secret.slice(6) : secret), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)));
    const expected = btoa(String.fromCharCode(...mac));

    for (const part of sig.split(' ')) {
        const candidate = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part;
        if (timingSafeEqual(candidate, expected)) return { ok: true, id };
    }
    return { ok: false, reason: 'signature invalide' };
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function sha256(t: string): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
    return Array.from(h, x => x.toString(16).padStart(2, '0')).join('');
}

// Lance le générateur de dossier (GitHub Actions) quand tout est reçu : fiche complète + photos.
// Renvoie 'incomplet' | 'deja' | 'lancee' | 'echec'.
export async function lancerGeneration(db: SupabaseClient, order: Record<string, any>, par = 'auto', forcer = false): Promise<string> {
    const { data: files } = await db.from('order_files').select('kind').eq('order_id', order.id);
    if (!forcer && missingItems(order, (files ?? []).map((f: { kind: string }) => f.kind)).length) return 'incomplet';
    const { data: prec } = await db.from('dossier_generations').select('id, status, expires_at').eq('order_id', order.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!forcer && prec && (['a_relire', 'validee'].includes(prec.status) ||
        (['lancee', 'en_cours'].includes(prec.status) && new Date(prec.expires_at) > new Date()))) return 'deja';
    if (!env('GITHUB_DISPATCH_TOKEN') && par === 'auto') return 'echec';   // pas encore configuré : rien à enregistrer
    const jeton = randomToken();
    const { data: g, error } = await db.from('dossier_generations')
        .insert({ order_id: order.id, token_hash: await sha256(jeton), lance_par: par }).select('id').single();
    if (error || !g) { console.error(error); return 'echec'; }
    const gh = env('GITHUB_DISPATCH_TOKEN');
    let erreur = gh ? '' : 'GITHUB_DISPATCH_TOKEN manquant dans les secrets Supabase';
    if (gh) {
        const r = await fetch(`https://api.github.com/repos/${env('GITHUB_REPO', 'eliassaoe/urbatik')}/dispatches`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${gh}`, Accept: 'application/vnd.github+json', 'User-Agent': 'urbatik', 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type: 'generer-dossier', client_payload: { generation_id: g.id, token: jeton } }),
        });
        if (!r.ok) erreur = `GitHub a refusé le lancement (${r.status})`;
    }
    if (erreur) {
        await db.from('dossier_generations').update({ status: 'echec', erreur, updated_at: new Date().toISOString() }).eq('id', g.id);
        return 'echec';
    }
    return 'lancee';
}
