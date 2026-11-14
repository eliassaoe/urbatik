// dossier-abandons : relance les personnes qui ont laissé leur email au dernier écran du formulaire
// (dossier_clients.offer_started_at) sans payer. 3 emails : 1 h, 24 h et 7 jours après.
// Appelée toutes les heures par pg_cron (job « dossier-relances-abandons ») avec x-cron-token = CRON_TOKEN.
// Autonome (pas de _shared) pour se déployer en un seul fichier. Déployer avec --no-verify-jwt.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
let S: Record<string, string> = {};
const env = (k: string, d = '') => Deno.env.get(k) || S[k] || d;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const STEPS_H = [1, 24, 24 * 7];

function shell(inner: string): string {
    return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f6f2;font:16px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1d1f1e">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:18px;letter-spacing:-.02em;margin-bottom:16px">${esc(env('BRAND', 'Urbatik'))}</div>
<div style="background:#fff;border:1px solid #e3e1da;border-radius:12px;padding:20px">${inner}</div>
<p style="color:#8a8f8c;font-size:13px;margin:14px 4px">Vous recevez cet email parce que vous avez commencé une demande sur urbatik.com. Pour ne plus en recevoir, répondez simplement « STOP ».</p>
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

    let sent = 0;
    for (const c of clients ?? []) {
        if (/@linkfinderai\.com$/i.test(c.email)) continue; // adresses internes / tests
        const due = new Date(c.offer_started_at).getTime() + STEPS_H[c.abandon_reminders_sent] * 3_600_000;
        if (Date.now() < due) continue;
        const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
            .eq('contact_email', c.email).not('status', 'in', '(en_attente_paiement,annulee)');
        if ((count ?? 0) > 0) {
            await db.from('dossier_clients').update({ abandon_reminders_sent: STEPS_H.length }).eq('email', c.email);
            continue;
        }
        const prenom = String(c.nom ?? '').trim().split(/\s+/)[0] ?? '';
        const m = message(c.abandon_reminders_sent, prenom, site, call);
        const res = await fetch(hook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: c.email, subject: m.subject, html: m.html, text: m.text, from_name: env('BRAND', 'Urbatik') }),
        }).catch(e => { console.error(e); return null; });
        if (res?.ok) {
            await db.from('dossier_clients').update({
                abandon_reminders_sent: c.abandon_reminders_sent + 1, last_abandon_reminder_at: new Date().toISOString(),
            }).eq('email', c.email);
            sent++;
        }
    }
    return json({ ok: true, sent });
});
