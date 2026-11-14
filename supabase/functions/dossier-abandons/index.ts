// dossier-abandons : deux suites de relances, sans payer.
//  A. « abandon » : email laissé au dernier écran du formulaire (offer_started_at) → 3 emails à +1 h, +24 h, +7 j.
//  B. « nurture » : visite identifiée par le lien ?e= (visited_at) sans aller jusqu'au dernier écran
//     → 6 emails à +3 h, +2 j, +7 j, +21 j, +45 j, +75 j.
// Les deux s'arrêtent dès qu'une commande est payée ; B s'arrête dès que A commence.
// Appelée toutes les heures par pg_cron (job « dossier-relances-abandons ») avec x-cron-token = CRON_TOKEN.
// Autonome (pas de _shared) pour se déployer en un seul fichier. Déployer avec --no-verify-jwt.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
let S: Record<string, string> = {};
const env = (k: string, d = '') => Deno.env.get(k) || S[k] || d;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const STEPS_H = [1, 24, 24 * 7];
const NURTURE_H = [3, 48, 24 * 7, 24 * 21, 24 * 45, 24 * 75];

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
            html: shell(`<p>${esc(hello)}</p><p>Vous avez préparé votre demande sur Urbatik. Il ne reste qu'à la valider : on s'occupe de tout le dossier (Cerfa, plans, photomontage, notice) et vous le recevez en moins d'une semaine.</p>${btn(order, 'Valider mon dossier')}<p>Remboursé si la mairie refuse. Une question ? <a href="${esc(call)}">Parlons-en 15 minutes</a>.</p>`),
            text: `${hello}\n\nVous avez préparé votre demande sur Urbatik. Il ne reste qu'à la valider : on s'occupe de tout le dossier et vous le recevez en moins d'une semaine.\n\nValider mon dossier : ${order}\n\nRemboursé si la mairie refuse. Une question ? 15 minutes : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
        };
    }
    if (step === 1) {
        return {
            subject: 'Une question avant de lancer votre dossier ?',
            html: shell(`<p>${esc(hello)}</p><p>Souvent, ce qui retient, c'est une de ces questions :</p><ul><li><strong>Le prix ?</strong> Fixe et annoncé avant de payer : 249 € HT la déclaration préalable, 790 € HT le permis. <a href="${esc(site)}/tarifs">Voir ce qui est inclus</a>.</li><li><strong>Et si la mairie refuse ?</strong> On vous rembourse intégralement.</li><li><strong>Les photos ?</strong> Vous pouvez les envoyer après le paiement, depuis votre téléphone.</li></ul>${btn(order, 'Reprendre ma demande')}<p>Ou <a href="${esc(call)}">réservez 15 minutes</a> et on regarde votre chantier ensemble.</p>`),
            text: `${hello}\n\nCe qui retient souvent :\n- Le prix : fixe, 249 € HT la déclaration préalable, 790 € HT le permis (${site}/tarifs)\n- Si la mairie refuse : on vous rembourse intégralement\n- Les photos : vous pouvez les envoyer après le paiement\n\nReprendre ma demande : ${order}\nOu 15 minutes ensemble : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
        };
    }
    return {
        subject: 'Pas de chantier en ce moment ?',
        html: shell(`<p>${esc(hello)}</p><p>Pas de souci si le chantier n'est pas encore signé. Gardez cet email : le jour où un client vous demande une pergola, une véranda, un abri ou une piscine, votre dossier de mairie se lance en 2 minutes ici :</p>${btn(order, 'Lancer un dossier')}<p>Vous pouvez aussi l'ajouter à vos devis : « démarches mairie incluses, dossier sous 7 jours ». Et si vous avez un doute sur un projet, <a href="${esc(call)}">appelez-nous 15 minutes</a>, on vous dit s'il faut une déclaration ou un permis.</p>`),
        text: `${hello}\n\nPas de souci si le chantier n'est pas encore signé. Gardez cet email : le jour où un client vous demande une pergola, une véranda, un abri ou une piscine, votre dossier se lance en 2 minutes : ${order}\n\nUn doute sur un projet ? 15 minutes : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
    };
}

function nurture(step: number, site: string, call: string): { subject: string; html: string; text: string } {
    const order = `${site}/commande?utm_source=relance&utm_medium=email&utm_content=n${step + 1}`;
    const tarifs = `${site}/tarifs?utm_source=relance&utm_medium=email&utm_content=n${step + 1}`;
    const T: [string, string, string][] = [
        ['Votre dossier de mairie en 2 minutes',
         `Merci de votre visite sur Urbatik. Quand un chantier demande une déclaration préalable ou un permis, vous remplissez 2 minutes en ligne et on prépare tout le dossier : Cerfa, plans, photomontage, notice. Livré en moins d'une semaine, remboursé si la mairie refuse.`,
         'Lancer un dossier'],
        ['Comment on prépare vos dossiers de mairie',
         `En 3 étapes : 1. vous décrivez le chantier et ajoutez 3 photos ; 2. on vérifie les règles du PLU de la commune ; 3. vous recevez le dossier complet, relu par un professionnel, prêt à déposer. Prix fixe, annoncé avant de payer.`,
         'Voir les tarifs'],
        ['15 minutes pour regarder votre prochain chantier ?',
         `Si vous avez un projet en vue (pergola, véranda, abri, piscine, clôture…), on peut regarder ensemble en 15 minutes s'il faut une déclaration ou un permis, et ce que la mairie va demander.`,
         'Réserver 15 minutes'],
        ['Pas de chantier en ce moment ?',
         `Pas de souci. Gardez cet email : le jour où un client signe, votre dossier de mairie se lance en 2 minutes. Beaucoup d'artisans l'ajoutent directement à leurs devis : « démarches mairie incluses, dossier sous 7 jours ».`,
         'Lancer un dossier'],
        ['Un chantier qui démarre bientôt ?',
         `Avant de poser, il faut l'accord de la mairie. Plus le dossier part tôt, plus vite vous pouvez commencer. On s'en occupe en moins d'une semaine.`,
         'Lancer un dossier'],
        ['On reste là quand un dossier se présente',
         `C'est notre dernier message. Le jour où une déclaration préalable ou un permis bloque un de vos chantiers, Urbatik le prépare pour vous en moins d'une semaine, remboursé si la mairie refuse.`,
         'Lancer un dossier'],
    ];
    const [subject, body, label] = T[step];
    const href = label === 'Voir les tarifs' ? tarifs : label === 'Réserver 15 minutes' ? call : order;
    const extra = label === 'Réserver 15 minutes' ? `<p>Ou lancez directement votre dossier : <a href="${esc(order)}">2 minutes en ligne</a>.</p>`
        : `<p>Une question ? <a href="${esc(call)}">Parlons-en 15 minutes</a>.</p>`;
    return {
        subject,
        html: shell(`<p>Bonjour,</p><p>${esc(body)}</p>${btn(href, label)}${extra}`),
        text: `Bonjour,\n\n${body}\n\n${label} : ${href}\nUne question ? 15 minutes : ${call}\n\nPour ne plus recevoir d'email, répondez STOP.`,
    };
}

Deno.serve(async (req) => {
    const { data } = await db.from('dossier_settings').select('key, value');
    S = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (!env('CRON_TOKEN') || req.headers.get('x-cron-token') !== env('CRON_TOKEN')) return json({ error: 'forbidden' }, 403);
    const site = env('SITE_URL', 'https://urbatik.com').replace(/\/$/, '');
    const call = env('CALL_URL', 'https://calendly.com/hamoureliasse/appel-avec-urbatik');
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
        .gte('visited_at', new Date(Date.now() - 120 * 86_400_000).toISOString());
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
    return json({ ok: true, sent, nurtured });
});
