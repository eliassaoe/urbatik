// dossier-abandons : deux suites de relances, sans payer.
//  A. « abandon » : email laissé au dernier écran du formulaire (offer_started_at) → 3 emails à +1 h, +24 h, +7 j.
//  B. « nurture » : visite identifiée par le lien ?e= (visited_at) sans aller jusqu'au dernier écran
//     → 10 emails sur 5 mois (+3 h, +2 j, +5 j, +10 j, +21 j, +35 j, +55 j, +80 j, +110 j, +150 j).
//     Prioritaire : chaque visite d'un prospect connu prévient le gérant (dossier-visit).
//  C. « réponse » : prospect qui a répondu à la prospection Explee (projet creha 61157, lead « Hot »)
//     sans être venu sur le site → 8 emails sur 5 mois (+10 j, +17 j, +25 j, +40 j, +60 j, +85 j, +115 j, +150 j).
//     Synchronisé ici à chaque passage depuis la page /relance (données Explee déjà publiées, voir syncExplee).
// Tout s'arrête dès qu'une commande est payée ; B s'arrête dès que A commence ; C s'arrête dès qu'il visite (B prend le relais).
// Décision du gérant, 18 nov. 2026 : relancer 6 à 10 fois sur plusieurs mois, le chantier arrive quand il arrive.
// Appelée toutes les heures par pg_cron (job « dossier-relances-abandons ») avec x-cron-token = CRON_TOKEN.
// Autonome (pas de _shared) pour se déployer en un seul fichier. Déployer avec --no-verify-jwt.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
let S: Record<string, string> = {};
const env = (k: string, d = '') => Deno.env.get(k) || S[k] || d;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const STEPS_H = [1, 24, 24 * 7];
const D = 24;
const NURTURE_H = [3, 2 * D, 5 * D, 10 * D, 21 * D, 35 * D, 55 * D, 80 * D, 110 * D, 150 * D];
const REPLY_H = [10 * D, 17 * D, 25 * D, 40 * D, 60 * D, 85 * D, 115 * D, 150 * D];
const EXPLEE_PROJECT = 61157;
const RELANCE_DATA = 'https://raw.githubusercontent.com/eliassaoe/findlinkai/main/relance.html';

function shell(inner: string): string {
    return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f6f2;font:16px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1d1f1e">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:18px;letter-spacing:-.02em;margin-bottom:16px">${esc(env('BRAND', 'Urbatik'))}</div>
<div style="background:#fff;border:1px solid #e3e1da;border-radius:12px;padding:20px">${inner}</div>
<p style="color:#8a8f8c;font-size:13px;margin:14px 4px">Vous recevez cet email suite à votre visite sur urbatik.com. Pour ne plus en recevoir, répondez simplement « STOP ».</p>
</div></body></html>`;
}
const btn = (href: string, label: string) =>
    `<p><a href="${esc(href)}" style="display:inline-block;background:#0b0b0c;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;

function message(step: number, prenom: string, site: string, call: string): { subject: string; html: string; text: string } {
    const order = `${site}/commande?utm_source=relance&utm_medium=email&utm_content=r${step + 1}`;
    const hello = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
    if (step === 0) {
        return {
            subject: 'Votre dossier de mairie est prêt à partir',
            html: shell(`<p>${esc(hello)}</p><p>Vous avez préparé votre demande sur Urbatik. Il ne reste qu'à la valider : on s'occupe de tout le dossier (Cerfa, plans, photomontage, notice) et vous le recevez en 72 h.</p>${btn(order, 'Valider mon dossier')}<p>Remboursé si la mairie refuse. Une question ? <a href="${esc(call)}">Écrivez-nous sur WhatsApp</a>.</p>`),
            text: `${hello}\n\nVous avez préparé votre demande sur Urbatik. Il ne reste qu'à la valider : on s'occupe de tout le dossier et vous le recevez en 72 h.\n\nValider mon dossier : ${order}\n\nRemboursé si la mairie refuse. Une question ? WhatsApp : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
        };
    }
    if (step === 1) {
        return {
            subject: 'Une question avant de lancer votre dossier ?',
            html: shell(`<p>${esc(hello)}</p><p>Souvent, ce qui retient, c'est une de ces questions :</p><ul><li><strong>Le prix ?</strong> Fixe et annoncé avant de payer : 249 € HT la déclaration préalable, 390 € HT le permis. <a href="${esc(site)}/tarifs">Voir ce qui est inclus</a>.</li><li><strong>Et si la mairie refuse ?</strong> On vous rembourse intégralement.</li><li><strong>Les photos ?</strong> Vous pouvez les envoyer après le paiement, depuis votre téléphone.</li></ul>${btn(order, 'Reprendre ma demande')}<p>Ou <a href="${esc(call)}">écrivez-nous sur WhatsApp</a> et on regarde votre chantier ensemble.</p>`),
            text: `${hello}\n\nCe qui retient souvent :\n- Le prix : fixe, 249 € HT la déclaration préalable, 390 € HT le permis (${site}/tarifs)\n- Si la mairie refuse : on vous rembourse intégralement\n- Les photos : vous pouvez les envoyer après le paiement\n\nReprendre ma demande : ${order}\nOu sur WhatsApp : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
        };
    }
    return {
        subject: 'Pas de chantier en ce moment ?',
        html: shell(`<p>${esc(hello)}</p><p>Pas de souci si le chantier n'est pas encore signé. Gardez cet email : le jour où un client vous demande une pergola, une véranda, un abri ou une piscine, votre dossier de mairie se lance en 2 minutes ici :</p>${btn(order, 'Lancer un dossier')}<p>Vous pouvez aussi l'ajouter à vos devis : « démarches mairie incluses, dossier sous 72 h ». Et si vous avez un doute sur un projet, <a href="${esc(call)}">écrivez-nous sur WhatsApp</a>, on vous dit s'il faut une déclaration ou un permis.</p>`),
        text: `${hello}\n\nPas de souci si le chantier n'est pas encore signé. Gardez cet email : le jour où un client vous demande une pergola, une véranda, un abri ou une piscine, votre dossier se lance en 2 minutes : ${order}\n\nUn doute sur un projet ? WhatsApp : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
    };
}

function nurture(step: number, site: string, call: string): { subject: string; html: string; text: string } {
    const order = `${site}/commande?utm_source=relance&utm_medium=email&utm_content=n${step + 1}`;
    const tarifs = `${site}/tarifs?utm_source=relance&utm_medium=email&utm_content=n${step + 1}`;
    const T: [string, string, string][] = [
        ['Votre dossier de mairie en 2 minutes',
         `Merci de votre visite sur Urbatik. Quand un chantier demande une déclaration préalable ou un permis, vous remplissez 2 minutes en ligne et on prépare tout le dossier : Cerfa, plans, photomontage, notice. Livré en 72 h, remboursé si la mairie refuse.`,
         'Lancer un dossier'],
        ['Comment on prépare vos dossiers de mairie',
         `En 3 étapes : 1. vous décrivez le chantier et ajoutez 3 photos ; 2. on vérifie les règles du PLU de la commune ; 3. notre bureau d'études partenaire réalise le dossier complet, prêt à déposer. Prix fixe, annoncé avant de payer.`,
         'Voir les tarifs'],
        ['Une question sur votre prochain chantier ?',
         `Si vous avez un projet en vue (pergola, véranda, abri, piscine, clôture…), écrivez-nous sur WhatsApp : on vous dit s'il faut une déclaration ou un permis, et ce que la mairie va demander.`,
         'Écrire sur WhatsApp'],
        ['À quoi ressemble un dossier prêt à déposer',
         `Plan de situation, plan de masse, façades avant et après, photomontage, notice et Cerfa rempli : c'est ce que vous recevez, prêt à déposer en mairie ou en ligne. Des exemples sont sur notre site.`,
         'Voir les tarifs'],
        ['Pas de chantier en ce moment ?',
         `Pas de souci. Gardez cet email : le jour où un client signe, votre dossier de mairie se lance en 2 minutes. Beaucoup d'artisans l'ajoutent directement à leurs devis : « démarches mairie incluses, dossier sous 72 h ».`,
         'Lancer un dossier'],
        ['Un chantier qui démarre bientôt ?',
         `Avant de poser, il faut l'accord de la mairie, et l'instruction prend un mois pour une déclaration préalable. Plus le dossier part tôt, plus vite vous pouvez commencer. On le prépare en 72 h.`,
         'Lancer un dossier'],
        ['Le dossier de mairie, c\'est souvent ce qui retarde le chantier',
         `Un dossier incomplet, c'est un mois de plus avant de poser. On vérifie le PLU de la commune avant de préparer le dossier, pour qu'il parte complet du premier coup.`,
         'Lancer un dossier'],
        ['Vos chantiers du printemps se préparent maintenant',
         `Les clients signent en hiver pour poser au printemps. Comme la mairie prend un mois pour répondre, c'est le bon moment pour lancer les dossiers : 2 minutes en ligne, on s'occupe du reste.`,
         'Lancer un dossier'],
        ['Une déclaration ou un permis ?',
         `Pergola, véranda, abri, piscine, clôture : selon la surface et la commune, c'est une déclaration préalable (249 € HT) ou un permis (390 € HT). Si vous avez un doute sur un projet, écrivez-nous, on vous répond.`,
         'Écrire sur WhatsApp'],
        ['On reste là quand un dossier se présente',
         `C'est notre dernier message. Le jour où une déclaration préalable ou un permis bloque un de vos chantiers, Urbatik le prépare pour vous en 72 h, remboursé si la mairie refuse.`,
         'Lancer un dossier'],
    ];
    const [subject, body, label] = T[step];
    const href = label === 'Voir les tarifs' ? tarifs : label === 'Écrire sur WhatsApp' ? call : order;
    const extra = label === 'Écrire sur WhatsApp' ? `<p>Ou lancez directement votre dossier : <a href="${esc(order)}">2 minutes en ligne</a>.</p>`
        : `<p>Une question ? <a href="${esc(call)}">Écrivez-nous sur WhatsApp</a>.</p>`;
    return {
        subject,
        html: shell(`<p>Bonjour,</p><p>${esc(body)}</p>${btn(href, label)}${extra}`),
        text: `Bonjour,\n\n${body}\n\n${label} : ${href}\nUne question ? WhatsApp : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
    };
}

// C. Prospects qui ont répondu à la prospection (creha) sans venir sur le site.
function replyNurture(step: number, prenom: string, site: string, call: string, email: string): { subject: string; html: string; text: string } {
    const link = (p: string) => `${site}${p}${p.includes('?') ? '&' : '?'}utm_source=relance&utm_medium=email&utm_campaign=creha_reponse&utm_content=c${step + 1}&e=${encodeURIComponent(email)}`;
    const order = link('/commande'), home = link('/'), ex = link('/exemples');
    const hello = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
    const T: [string, string, string, string][] = [
        ['Suite à votre réponse : vos dossiers de mairie',
         `Merci de nous avoir répondu il y a quelques jours. Pour rappel, on prépare les dossiers de mairie de vos chantiers (déclaration préalable, permis) : vous décrivez le chantier en 2 minutes en ligne, on s'occupe de tout le dossier, vous le recevez en 72 h.`,
         'Voir comment ça marche', home],
        ['Ce que vous recevez, concrètement',
         `Un dossier complet, prêt à déposer : Cerfa rempli, plan de situation, plan de masse, façades, photomontage et notice. Vous pouvez voir des exemples sur notre site.`,
         'Voir des exemples', ex],
        ['Le prix, sans surprise',
         `249 € HT la déclaration préalable, 390 € HT le permis de construire, prix fixe annoncé avant de payer. Si la mairie refuse le dossier, on vous rembourse.`,
         'Lancer un dossier', order],
        ['Un chantier en vue ?',
         `Le jour où un client signe une pergola, une véranda, un abri ou une piscine, gardez ce lien : la demande se fait en 2 minutes, et vos équipes restent sur les chantiers pendant qu'on s'occupe de la mairie.`,
         'Lancer un dossier', order],
        ['Une question sur un projet ?',
         `Déclaration ou permis, règles du PLU, délais de la mairie : si vous avez un doute sur un chantier, écrivez-nous sur WhatsApp, on vous répond.`,
         'Écrire sur WhatsApp', call],
        ['Vos chantiers du printemps se préparent maintenant',
         `Les clients signent en hiver pour poser au printemps, et la mairie prend un mois pour répondre. C'est le bon moment pour lancer les dossiers : 2 minutes en ligne, on s'occupe du reste.`,
         'Lancer un dossier', order],
        ['Ajoutez la mairie à vos devis',
         `Beaucoup d'artisans l'écrivent directement dans leurs devis : « démarches mairie incluses, dossier sous 72 h ». Le client signe plus facilement, et c'est nous qui faisons le dossier.`,
         'Lancer un dossier', order],
        ['On reste là quand un dossier se présente',
         `C'est notre dernier message. Le jour où une déclaration préalable ou un permis bloque un de vos chantiers, on le prépare en 72 h, remboursé si la mairie refuse.`,
         'Lancer un dossier', order],
    ];
    const [subject, body, label, href] = T[step];
    const extra = href === call ? `<p>Ou lancez directement votre dossier : <a href="${esc(order)}">2 minutes en ligne</a>.</p>`
        : `<p>Une question ? <a href="${esc(call)}">Écrivez-nous sur WhatsApp</a>.</p>`;
    return {
        subject,
        html: shell(`<p>${esc(hello)}</p><p>${esc(body)}</p>${btn(href, label)}${extra}`)
            .replace('suite à votre visite sur urbatik.com', 'suite à notre échange par email sur vos dossiers de mairie'),
        text: `${hello}\n\n${body}\n\n${label} : ${href}\nUne question ? WhatsApp : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
    };
}

// Les prospects « Hot » du projet creha, lus dans la page /relance (même données Explee, déjà calculées
// toutes les 2 h par le dépôt findlinkai) : pas de clé Explee à stocker ici.
async function syncExplee(): Promise<number> {
    let html = '';
    try { const r = await fetch(RELANCE_DATA); if (!r.ok) return 0; html = await r.text(); } catch { return 0; }
    const i = html.indexOf('const PAGE = ');
    if (i < 0) return 0;
    const j = html.indexOf(';\n', i); // une vraie fin de ligne ne peut pas être dans du JSON
    let page: { blob?: { plain?: { leads?: Record<string, unknown>[] } } };
    try { page = JSON.parse(html.slice(i + 13, j < 0 ? undefined : j)); } catch { return 0; }
    const leads = page?.blob?.plain?.leads ?? [];
    let n = 0;
    for (const l of leads) {
        if (Number(l.project_id) !== EXPLEE_PROJECT) continue;
        const email = String(l.email ?? '').trim().toLowerCase();
        if (!/^[^\s@*]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        if (l.bucket === 'lost' || l.status === 'lost') continue;
        if (/ne plus (me )?contacter|d[ée]sinscri|\bstop\b|pas int[ée]ress|retirez|unsubscribe/i.test(String(l.last_reply ?? ''))) continue;
        const hot = String(l.hot_since || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
        const phones = (l.phones as { pretty?: string }[] | undefined) ?? [];
        const { data: c } = await db.from('dossier_clients').select('email, replied_at, nom, entreprise, tel, metier').eq('email', email).maybeSingle();
        const fields = {
            // prénom fiable seulement si Explee en a trouvé un (sinon « Bonjour, » plutôt que « Bonjour Yayaac, »)
            nom: (c?.nom || (/^[\p{L}' -]{2,30}$/u.test(String(l.first_name ?? '')) ? String(l.name ?? '') : '')).slice(0, 120) || null,
            entreprise: (c?.entreprise || String(l.company ?? '')).slice(0, 160) || null,
            tel: (c?.tel || phones.map(p => p.pretty).filter(Boolean).join(' / ')).slice(0, 80) || null,
            metier: (c?.metier || String(l.campaign ?? '')).slice(0, 120) || null,
        };
        if (!c) {
            await db.from('dossier_clients').insert({ email, ...fields, replied_at: `${hot}T09:00:00Z`, source: 'explee_reponse', updated_at: new Date().toISOString() });
            n++;
        } else if (!c.replied_at) {
            await db.from('dossier_clients').update({ ...fields, replied_at: `${hot}T09:00:00Z`, updated_at: new Date().toISOString() }).eq('email', email);
            n++;
        }
    }
    return n;
}

Deno.serve(async (req) => {
    const { data } = await db.from('dossier_settings').select('key, value');
    S = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (!env('CRON_TOKEN') || req.headers.get('x-cron-token') !== env('CRON_TOKEN')) return json({ error: 'forbidden' }, 403);
    const site = env('SITE_URL', 'https://urbatik.com').replace(/\/$/, '');
    const call = env('CALL_URL', 'https://wa.me/33626344475?text=Bonjour%2C%20j%27ai%20une%20question%20sur%20un%20dossier%20de%20mairie.');
    const hook = env('N8N_EMAIL_WEBHOOK');
    if (!hook) return json({ error: 'N8N_EMAIL_WEBHOOK absent' }, 503);

    const { data: clients, error } = await db.from('dossier_clients')
        .select('email, nom, offer_started_at, abandon_reminders_sent')
        .not('offer_started_at', 'is', null).is('unsubscribed_at', null).lt('abandon_reminders_sent', STEPS_H.length)
        .gte('offer_started_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (error) { console.error(error); return json({ error: 'db' }, 500); }

    const send = async (to: string, m: { subject: string; html: string; text: string }) => {
        const res = await fetch(hook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject: m.subject, html: m.html, text: m.text, from_name: env('BRAND', 'Urbatik') }),
        }).catch(e => { console.error(e); return null; });
        return !!res?.ok;
    };
    const paid = async (email: string) => {
        const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
            .eq('contact_email', email).not('status', 'in', '(en_attente_paiement,annulee)');
        return (count ?? 0) > 0;
    };
    let sent = 0;
    for (const c of clients ?? []) {
        if (/@linkfinderai\.com$/i.test(c.email)) continue; // adresses internes / tests
        const due = new Date(c.offer_started_at).getTime() + STEPS_H[c.abandon_reminders_sent] * 3_600_000;
        if (Date.now() < due) continue;
        if (await paid(c.email)) { await db.from('dossier_clients').update({ abandon_reminders_sent: STEPS_H.length }).eq('email', c.email); continue; }
        const prenom = String(c.nom ?? '').trim().split(/\s+/)[0] ?? '';
        if (await send(c.email, message(c.abandon_reminders_sent, prenom, site, call))) {
            await db.from('dossier_clients').update({
                abandon_reminders_sent: c.abandon_reminders_sent + 1, last_abandon_reminder_at: new Date().toISOString(),
            }).eq('email', c.email);
            sent++;
        }
    }

    // B. Nurture : visiteurs identifiés qui ne sont pas allés jusqu'au dernier écran.
    const { data: visitors, error: vErr } = await db.from('dossier_clients')
        .select('email, visited_at, nurture_sent')
        .not('visited_at', 'is', null).is('offer_started_at', null).is('unsubscribed_at', null)
        .lt('nurture_sent', NURTURE_H.length)
        .gte('visited_at', new Date(Date.now() - 200 * 86_400_000).toISOString());
    if (vErr) console.error(vErr);
    let nurtured = 0;
    for (const v of visitors ?? []) {
        if (/@linkfinderai\.com$/i.test(v.email)) continue;
        const due = new Date(v.visited_at).getTime() + NURTURE_H[v.nurture_sent] * 3_600_000;
        if (Date.now() < due) continue;
        if (await paid(v.email)) { await db.from('dossier_clients').update({ nurture_sent: NURTURE_H.length }).eq('email', v.email); continue; }
        if (await send(v.email, nurture(v.nurture_sent, site, call))) {
            await db.from('dossier_clients').update({ nurture_sent: v.nurture_sent + 1, last_nurture_at: new Date().toISOString() }).eq('email', v.email);
            nurtured++;
        }
    }

    // C. Prospects qui ont répondu (creha), pas encore venus sur le site.
    const synced = await syncExplee();
    const { data: repliers, error: rErr } = await db.from('dossier_clients')
        .select('email, nom, replied_at, reply_nurture_sent')
        .not('replied_at', 'is', null).is('visited_at', null).is('offer_started_at', null).is('unsubscribed_at', null)
        .lt('reply_nurture_sent', REPLY_H.length)
        .gte('replied_at', new Date(Date.now() - 200 * 86_400_000).toISOString());
    if (rErr) console.error(rErr);
    let replied = 0;
    for (const r of repliers ?? []) {
        if (/@linkfinderai\.com$/i.test(r.email)) continue;
        const due = new Date(r.replied_at).getTime() + REPLY_H[r.reply_nurture_sent] * 3_600_000;
        if (Date.now() < due) continue;
        if (await paid(r.email)) { await db.from('dossier_clients').update({ reply_nurture_sent: REPLY_H.length }).eq('email', r.email); continue; }
        const prenom = String(r.nom ?? '').trim().split(/\s+/)[0] ?? '';
        if (await send(r.email, replyNurture(r.reply_nurture_sent, prenom, site, call, r.email))) {
            await db.from('dossier_clients').update({ reply_nurture_sent: r.reply_nurture_sent + 1, last_reply_nurture_at: new Date().toISOString() }).eq('email', r.email);
            replied++;
        }
    }
    return json({ ok: true, sent, nurtured, synced, replied });
});
