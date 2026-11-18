// dossier-relances : relance par email les clients qui ont payé sans envoyer leurs photos.
//
// Appelée une fois par jour par pg_cron (job « dossier-relances-photos », 8 h UTC) avec l'en-tête
// x-cron-token = CRON_TOKEN (dossier_settings). Relances à J+1, J+3 et J+7 après le paiement,
// tant qu'il manque une des trois photos obligatoires. Déployer avec --no-verify-jwt.
// + Suivi mairie (18 nov. 2026, docs/suivi-mairie.md) : après la livraison, la page /suivi demande
//   « La mairie a accepté ? Oui / Non ». À livraison + RAPPEL_JOURS : un email pose la question. À livraison
//   + PRESUME_JOURS sans réponse : le dossier passe en « accordee » (presumee) et un email dit qu'il reste
//   possible de répondre « Non » (le dossier est alors retravaillé sans frais).

import {
    admin, json, loadSettings, env, FILE_KINDS, REQUIRED_PHOTOS, TYPES, PRESUME_JOURS, RAPPEL_JOURS, suiviUrl, sendEmail, emailShell, esc, CALL_URL, TypeDossier,
} from '../_shared/dossier-express.ts';

const DAYS = [1, 3, 7];

Deno.serve(async (req) => {
    await loadSettings();
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (!env('CRON_TOKEN') || req.headers.get('x-cron-token') !== env('CRON_TOKEN')) return json({ error: 'forbidden' }, 403);
    const db = admin();

    const { data: orders, error } = await db.from('orders')
        .select('id, type_dossier, contact_nom, contact_email, client_token, ville, adresse_chantier, paid_at, photo_reminders_sent')
        .in('status', ['payee', 'en_preparation']).not('paid_at', 'is', null).lt('photo_reminders_sent', DAYS.length);
    if (error) { console.error(error); return json({ error: 'db' }, 500); }

    const sent: string[] = [];
    for (const o of orders ?? []) {
        const due = new Date(o.paid_at).getTime() + DAYS[o.photo_reminders_sent] * 86_400_000;
        if (Date.now() < due) continue;
        const { data: files } = await db.from('order_files').select('kind').eq('order_id', o.id);
        const kinds = (files ?? []).map(f => f.kind);
        const missing = REQUIRED_PHOTOS.filter(k => !kinds.includes(k)).map(k => FILE_KINDS[k]);
        if (!missing.length) {
            await db.from('orders').update({ photo_reminders_sent: DAYS.length }).eq('id', o.id);
            continue;
        }
        const lien = suiviUrl(o.client_token);
        const label = TYPES[o.type_dossier as TypeDossier].label;
        const html = emailShell(`
<p>Bonjour ${esc(o.contact_nom)},</p>
<p>Pour commencer votre ${esc(label.toLowerCase())} (${esc(o.adresse_chantier)}, ${esc(o.ville)}), il nous manque encore :</p>
<ul>${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
<p>Une photo prise au téléphone suffit. Votre dossier arrive en 72 h dès qu'on les a.</p>
<p><a href="${esc(lien)}" style="display:inline-block;background:#0b0b0c;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Ajouter mes photos</a></p>
<p>Un souci pour les prendre ? <a href="${esc(CALL_URL)}">Écrivez-nous sur WhatsApp</a>, on trouve une solution.</p>`);
        const text = [`Bonjour ${o.contact_nom},`, '', `Pour commencer votre ${label.toLowerCase()} (${o.adresse_chantier}, ${o.ville}), il nous manque encore :`,
            ...missing.map(m => `- ${m}`), '', "Une photo prise au téléphone suffit. Votre dossier arrive en 72 h dès qu'on les a.", '',
            `Ajouter mes photos : ${lien}`, `Un souci ? Écrivez-nous sur WhatsApp : ${CALL_URL}`].join('\n');
        const ok = await sendEmail(o.contact_email, `Il nous manque vos photos – ${o.ville}`, html, text);
        if (ok) {
            await db.from('orders').update({ photo_reminders_sent: o.photo_reminders_sent + 1, last_photo_reminder_at: new Date().toISOString() }).eq('id', o.id);
            sent.push(o.id);
        }
    }
    // Suivi mairie.
    const { data: suivis } = await db.from('orders')
        .select('id, status, contact_nom, contact_email, client_token, ville, adresse_chantier, livree_at, mairie_reminders_sent')
        .in('status', ['livree', 'deposee']).not('livree_at', 'is', null).lt('mairie_reminders_sent', 2);
    let mairie = 0;
    const jour = 86_400_000;
    for (const o of suivis ?? []) {
        const n = o.mairie_reminders_sent;
        const t0 = new Date(o.livree_at).getTime();
        if (Date.now() < t0 + (n === 0 ? RAPPEL_JOURS : PRESUME_JOURS) * jour) continue;
        const prenom = String(o.contact_nom ?? '').split(' ')[0];
        const lien = suiviUrl(o.client_token);
        const fin = new Date(t0 + PRESUME_JOURS * jour).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
        let subject: string, corps: string, label: string;
        if (n === 0 && Date.now() < t0 + PRESUME_JOURS * jour) {
            subject = `La mairie de ${o.ville} a-t-elle accepté votre dossier ?`;
            corps = `On suit votre dossier (${o.adresse_chantier}, ${o.ville}) jusqu'à l'accord de la mairie. A-t-elle accepté ? Répondez en un clic : Oui ou Non. Si elle demande une pièce ou refuse, cliquez Non : on retravaille le dossier sans frais. Sans réponse de votre part d'ici le ${fin}, on considère que c'est accepté, et vous pourrez toujours revenir cliquer Non ensuite.`;
            label = 'Oui / Non : répondre';
        } else {
            await db.from('orders').update({ status: 'accordee', decision_at: new Date().toISOString(), decision_presumee: true }).eq('id', o.id);
            subject = `Votre dossier de ${o.ville} est clos`;
            corps = `Sans nouvelle de votre part, on considère que la mairie a accepté votre dossier (${o.adresse_chantier}, ${o.ville}) et on le clôt. Si ce n'est pas le cas, une pièce demandée ou un refus, cliquez simplement Non sur votre page de suivi : on retravaille le dossier sans frais.`;
            label = 'Ma page de suivi';
        }
        const html = emailShell(`<p>Bonjour ${esc(prenom)},</p><p>${esc(corps)}</p>
<p><a href="${esc(lien)}" style="display:inline-block;background:#0b0b0c;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${esc(label)}</a></p>
<p>Une question ? <a href="${esc(CALL_URL)}">Écrivez-nous sur WhatsApp</a>.</p>`);
        const text = `Bonjour ${prenom},\n\n${corps}\n\n${label} : ${lien}\nWhatsApp : ${CALL_URL}`;
        const envoye = await sendEmail(o.contact_email, subject, html, text);
        await db.from('orders').update({ mairie_reminders_sent: n === 0 && subject.startsWith('La mairie') ? 1 : 2, last_mairie_reminder_at: new Date().toISOString() }).eq('id', o.id);
        if (envoye) mairie++;
    }
    return json({ ok: true, sent: sent.length, mairie });
});
