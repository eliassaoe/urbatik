// Suivi des prospects Urbatik (/admin/prospects). Même connexion que /admin/dossiers (jeton dans ce navigateur).
// La liste se recharge toute seule toutes les 20 secondes : une visite du site par un prospect (lien de l'email
// avec son adresse) le fait remonter en haut, en vert, avec une alerte.
(function () {
    'use strict';
    // Ce navigateur est celui du gérant : le site ne doit plus le compter comme un prospect (voir js/site.js).
    try { localStorage.setItem('urbatik_internal', '1'); localStorage.removeItem('urbatik_email'); } catch (e) {}
    const API = 'https://snxhsboboatjywgwdeds.supabase.co/functions/v1/admin-dossiers';
    const KEY = 'urbatik_admin_token';
    const REFRESH_MS = 20000;
    const $ = id => document.getElementById(id);
    const STATUS = [['a_appeler', 'À appeler'], ['rappel', 'Rappel prévu'], ['pas_repondu', 'Pas répondu'],
        ['lien_envoye', 'Lien envoyé'], ['rdv', 'Rendez-vous'], ['client', 'Client'], ['perdu', 'Perdu']];
    const CLOSED = ['client', 'perdu'];

    let token = ''; try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
    let filter = 'prio', data = [], seen = null, editing = 0, notif = false;
    const waOpen = new Set(); // panneaux WhatsApp ouverts : restent ouverts au rafraîchissement

    const parisDay = d => new Date(d).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const today = () => parisDay(Date.now());
    function ago(d) {
        const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
        if (m < 1) return "à l'instant";
        if (m < 60) return `il y a ${m} min`;
        if (parisDay(d) === today()) return 'à ' + new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
        return 'le ' + new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    async function api(action, extra) {
        const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action, token }, extra || {})) });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401 && action !== 'login') { logout(); throw new Error('session'); }
        if (!res.ok) throw Object.assign(new Error(body.error || 'erreur'), { data: body });
        return body;
    }
    const show = id => ['login', 'main'].forEach(x => { $(x).hidden = x !== id; });
    function logout() { token = ''; try { localStorage.removeItem(KEY); } catch (e) {} $('logout').hidden = true; show('login'); }

    $('loginForm').addEventListener('submit', async e => {
        e.preventDefault(); $('loginMsg').textContent = '';
        try {
            const r = await api('login', { password: $('pw').value });
            token = r.token; try { localStorage.setItem(KEY, token); } catch (x) {}
            e.target.reset(); start();
        } catch (err) { $('loginMsg').textContent = 'Mot de passe incorrect.'; }
    });
    $('logout').addEventListener('click', logout);
    $('chips').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        filter = b.dataset.f;
        document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
        render();
    });

    // Alertes navigateur + petit son quand un prospect visite le site.
    $('notifBtn').addEventListener('click', async () => {
        notif = true;
        try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) {}
        beep();
        $('notifBtn').textContent = 'Alertes activées';
        $('notifBtn').disabled = true;
    });
    let ctx = null;
    function beep() {
        try {
            ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.25);
        } catch (e) {}
    }
    function announce(p) {
        const who = [p.nom, p.entreprise].filter(Boolean).join(' · ') || p.email;
        $('alert').textContent = `${who} est sur le site (${ago(p.last_visit_at)}). Appelez maintenant${p.tel ? ' : ' + p.tel : ''}.`;
        $('alert').hidden = false;
        document.title = '● ' + who + ' · Prospects';
        if (notif) {
            beep();
            try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Prospect sur le site', { body: who + (p.tel ? ' · ' + p.tel : '') }); } catch (e) {}
        }
    }

    function isToday(p) {
        const t = today();
        return [p.last_visit_at, p.first_seen_at, p.crm_updated_at].some(d => d && parisDay(d) === t)
            || (p.crm_relance && p.crm_relance <= t && !p.crm_done_at && !CLOSED.includes(p.crm_status));
    }
    // Priorité d'appel (18 nov. 2026, gérant : « les gens à appeler en priorité ») : les appels font les ventes ET
    // apprennent ce que veulent les clients. Points : formulaire commencé, visites du site (récentes surtout),
    // réponse à la prospection, rappel prévu aujourd'hui. Hors liste : clos, déjà fait, sans numéro, appelé aujourd'hui.
    function score(p) {
        const h = d => d ? (Date.now() - new Date(d).getTime()) / 3600000 : Infinity;
        let s = 0;
        if (p.offer_started_at) s += 6;                                   // allé jusqu'au dernier écran
        s += Math.min(p.visits || 0, 4) * 2;                              // chaque visite du site
        if (h(p.last_visit_at) < 48) s += 4; else if (h(p.last_visit_at) < 24 * 7) s += 2;
        if (p.source === 'explee_reponse' || p.metier) s += 3;          // a répondu à la prospection
        if (p.crm_relance && p.crm_relance <= today()) s += 5;           // rappel promis
        if (p.prochain_chantier) {                                        // a besoin d'un dossier bientôt (19 nov. 2026)
            const j = (new Date(p.prochain_chantier) - new Date(today())) / 86400000;
            if (j <= 14) s += 8; else if (j <= 30) s += 3;
        }
        if (p.crm_status === 'rdv') s += 4;
        if (p.crm_status === 'pas_repondu') s -= 1;
        return s;
    }
    const callable = p => p.tel && !p.crm_done_at && !CLOSED.includes(p.crm_status)
        && !(p.crm_called_at && parisDay(p.crm_called_at) === today() && p.crm_call_result === 'ok')
        && !(p.crm_relance && p.crm_relance > today());
    function visible() {
        let rows = data;
        if (filter === 'prio') return rows.filter(callable).map(p => (p._score = score(p), p)).sort((a, b) => b._score - a._score);
        if (filter === 'today') rows = rows.filter(isToday);
        if (filter === 'visited') rows = rows.filter(p => p.last_visit_at);
        if (filter === 'todo') rows = rows.filter(p => !p.crm_done_at && !CLOSED.includes(p.crm_status));
        return rows.slice().sort((a, b) => {
            if (!!a.crm_done_at !== !!b.crm_done_at) return a.crm_done_at ? 1 : -1;
            const va = a.last_visit_at ? new Date(a.last_visit_at).getTime() : 0, vb = b.last_visit_at ? new Date(b.last_visit_at).getTime() : 0;
            if (va !== vb) return vb - va;
            return String(a.crm_relance || '9999').localeCompare(String(b.crm_relance || '9999'));
        });
    }

    function field(label, el) { const l = document.createElement('label'); l.append(label, el); return l; }
    function input(p, key, type) {
        const el = document.createElement(type === 'area' ? 'textarea' : 'input');
        if (type && type !== 'area') el.type = type;
        el.value = p[key] || '';
        hook(el, p, key);
        return el;
    }
    function hook(el, p, key) {
        let timer = null;
        el.addEventListener('focus', () => { editing++; });
        el.addEventListener('blur', () => { editing = Math.max(0, editing - 1); });
        const save = async () => {
            const value = el.value;
            if ((p[key] || '') === value) return;
            p[key] = value;
            try {
                await api('crm_update', { email: p.email, fields: { [key]: value } });
                p.crm_updated_at = new Date().toISOString();
                const s = el.closest('.p').querySelector('.saved'); s.textContent = 'Enregistré'; setTimeout(() => { s.textContent = ''; }, 1500);
            } catch (e) { alertMsg("Échec de l'enregistrement, réessayez."); }
        };
        el.addEventListener('change', save);
        if (el.tagName !== 'SELECT') el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 900); });
    }
    function alertMsg(t) { $('alert').textContent = t; $('alert').hidden = false; }

    function card(p) {
        const d = document.createElement('div');
        const recent = p.last_visit_at && Date.now() - new Date(p.last_visit_at).getTime() < 30 * 60000;
        d.className = 'p' + (recent && !p.crm_done_at ? ' hot' : '') + (p.crm_done_at || CLOSED.includes(p.crm_status) ? ' done' : '');

        const head = document.createElement('div'); head.className = 'head';
        const who = document.createElement('div'); who.className = 'who';
        who.textContent = p.nom || p.email;
        const sm = document.createElement('small'); sm.textContent = [p.entreprise, p.metier].filter(Boolean).join(' · '); who.appendChild(sm);
        const right = document.createElement('div'); right.className = 'row'; right.style.gap = '10px';
        const tel = document.createElement('span'); tel.className = 'tel'; tel.textContent = p.tel || 'pas de numéro';
        if (!p.tel) tel.style.color = 'var(--muted)';
        const v = document.createElement('span'); v.className = 'visit';
        if (p.last_visit_at) {
            v.textContent = `Site visité ${ago(p.last_visit_at)}${p.visits > 1 ? ` · ${p.visits} visites` : ''}`;
            if (recent) v.classList.add('now'); else if (parisDay(p.last_visit_at) === today()) v.classList.add('today');
        } else v.textContent = "N'a pas visité le site";
        right.append(tel, v);
        head.append(who, right);
        d.appendChild(head);

        if (p.prochain_chantier) { const c = document.createElement('div'); c.className = 'meta'; c.textContent = '🗓 Besoin d\'un dossier le ' + new Date(p.prochain_chantier).toLocaleDateString('fr-FR') + (p.prochain_chantier_quoi ? ' · ' + p.prochain_chantier_quoi : '') + (p.chantier_relance_sent ? ' · relancé' : ''); d.appendChild(c); }
        if (p.crm_said) { const s = document.createElement('div'); s.className = 'said'; s.textContent = '« ' + p.crm_said + ' »'; d.appendChild(s); }
        if (p.orders && p.orders.length) {
            const o = document.createElement('div'); o.className = 'meta';
            o.textContent = p.orders.some(x => x.paid) ? '✅ A payé un dossier' : '🟠 A rempli le formulaire sans payer';
            d.appendChild(o);
        } else if (p.offer_started_at) {
            const o = document.createElement('div'); o.className = 'meta'; o.textContent = '🟠 A commencé le formulaire de commande ' + ago(p.offer_started_at); d.appendChild(o);
        }

        // Demande remplie mais pas payée : lien qui la rouvre déjà remplie, à coller dans WhatsApp (19 nov. 2026).
        if (p.draft && Object.keys(p.draft).length) {
            const b = btoa(unescape(encodeURIComponent(JSON.stringify(p.draft)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const link = `https://urbatik.com/commande?utm_source=crm&utm_medium=whatsapp&e=${encodeURIComponent(p.email)}&d=${b}`;
            const c = document.createElement('button'); c.type = 'button'; c.className = 'act'; c.textContent = '📋 Copier le lien de sa demande remplie';
            c.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); c.textContent = '✓ Lien copié'; } catch (e) { prompt('Lien :', link); } });
            d.appendChild(c);
        }
        const acts = actions(p); d.appendChild(acts); d.appendChild(acts.wa);

        const f = document.createElement('div'); f.className = 'fields';
        const st = document.createElement('select');
        STATUS.forEach(([k, l]) => st.add(new Option(l, k)));
        st.value = p.crm_status || 'a_appeler';
        hook(st, p, 'crm_status');
        f.append(field('Statut', st), field('Prochaine action', input(p, 'crm_next')), field('Relance le', input(p, 'crm_relance', 'date')));
        d.appendChild(f);
        // « C'est quand votre prochain chantier ? Quand aurez-vous besoin du dossier ? » : on revient à ce moment-là
        // (email au prospect 7 jours avant + alerte au gérant, automatiques).
        const fc = document.createElement('div'); fc.className = 'fields';
        fc.append(field('Besoin du dossier le', input(p, 'prochain_chantier', 'date')), field('Pour quel chantier', input(p, 'prochain_chantier_quoi')));
        d.appendChild(fc);

        const f2 = document.createElement('div'); f2.className = 'fields2';
        f2.append(field("Notes d'appel", input(p, 'crm_notes', 'area')), field('Téléphone', input(p, 'tel')));
        d.appendChild(f2);

        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = p.email + (p.source ? ' · ' + (p.source === 'email_creha' ? 'campagne email' : p.source) : '') + ' ';
        const saved = document.createElement('span'); saved.className = 'saved'; meta.appendChild(saved);
        d.appendChild(meta);
        return d;
    }

    // Boutons d'appel : « Appelé » / « Pas répondu » enregistrent l'appel (heure, nombre) ; « Terminé » range le prospect en bas.
    function actions(p) {
        const a = document.createElement('div'); a.className = 'acts';
        const mk = (label, cls, on, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'act ' + cls + (on ? ' on' : ''); b.textContent = label; b.addEventListener('click', fn); return b; };
        const send = async (fields, local) => {
            Object.assign(p, local);
            try { await api('crm_update', { email: p.email, fields }); } catch (e) { alertMsg("Échec de l'enregistrement, réessayez."); }
            render();
        };
        const stamp = () => new Date().toISOString();
        a.append(
            mk('📞 Appelé', 'call', p.crm_call_result === 'ok', () => send({ call: 'ok' }, { crm_call_result: 'ok', crm_called_at: stamp(), crm_calls: (p.crm_calls || 0) + 1 })),
            mk('Pas répondu', 'miss', p.crm_call_result === 'no_answer', () => send({ call: 'no_answer' }, { crm_call_result: 'no_answer', crm_called_at: stamp(), crm_calls: (p.crm_calls || 0) + 1, crm_status: 'pas_repondu' })),
            mk(p.crm_done_at ? '✓ Terminé' : 'Terminé', 'fin', !!p.crm_done_at, () => send({ done: !p.crm_done_at }, { crm_done_at: p.crm_done_at ? null : stamp() })),
        );
        const wa = waNumber(p.tel);
        const wb = mk('💬 WhatsApp', 'wa', false, () => { panel.hidden = !panel.hidden; panel.hidden ? waOpen.delete(p.email) : waOpen.add(p.email); if (!panel.hidden) ta.focus(); });
        if (!wa) { wb.disabled = true; wb.title = 'Pas de numéro de portable'; }
        a.insertBefore(wb, a.children[2]);
        // Panneau WhatsApp : message prérempli selon la situation, modifiable, puis ouverture de WhatsApp sur ce numéro.
        const panel = document.createElement('div'); panel.className = 'wa-panel'; panel.hidden = !waOpen.has(p.email);
        const ta = document.createElement('textarea'); ta.value = waMessage(p); ta.rows = 4;
        ta.addEventListener('focus', () => { editing++; }); ta.addEventListener('blur', () => { editing = Math.max(0, editing - 1); });
        const go = document.createElement('a'); go.className = 'btn'; go.target = '_blank'; go.rel = 'noopener'; go.textContent = 'Envoyer sur WhatsApp';
        const upd = () => { go.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(ta.value); };
        ta.addEventListener('input', upd); upd();
        go.addEventListener('click', () => {
            const line = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' : WhatsApp envoyé (exemple : ' + waExample(p).label + ').';
            const notes = (p.crm_notes ? p.crm_notes + '\n' : '') + line;
            panel.hidden = true; waOpen.delete(p.email);
            send({ crm_notes: notes }, { crm_notes: notes });
        });
        // Le PDF d'exemple : wa.me ne peut pas joindre de fichier. Sur téléphone, « Avec le PDF » passe par le
        // partage du système (le PDF arrive au-dessus du message, on choisit le contact dans WhatsApp).
        // Partout ailleurs, le lien vers le PDF est déjà dans le texte.
        const ex = waExample(p);
        const pdf = document.createElement('button'); pdf.type = 'button'; pdf.className = 'btn2'; pdf.textContent = '📎 Avec le PDF (téléphone)';
        pdf.hidden = !(navigator.canShare && navigator.share);
        pdf.addEventListener('click', async () => {
            try {
                const blob = await (await fetch(ex.url)).blob();
                const file = new File([blob], ex.file, { type: 'application/pdf' });
                const text = ta.value.replace(/\n*Un exemple de dossier[^\n]*$/, '');
                if (!navigator.canShare({ files: [file] })) { window.open(go.href, '_blank'); return; }
                await navigator.share({ files: [file], text });
                go.click();
            } catch (e) { if (e && e.name !== 'AbortError') alertMsg("Le partage du PDF n'a pas marché : utilisez le bouton vert."); }
        });
        const row = document.createElement('div'); row.className = 'row'; row.append(go, pdf);
        const hint = document.createElement('span'); hint.className = 'meta';
        hint.textContent = `Exemple joint : ${ex.label}. WhatsApp s'ouvre avec le message et le lien du PDF : il reste à appuyer sur Envoyer.`;
        panel.append(ta, row, hint);
        a.wa = panel;
        const info = document.createElement('span'); info.className = 'meta';
        if (p.crm_called_at) {
            info.textContent = (p.crm_call_result === 'ok' ? 'Appelé ' : 'Pas répondu ') + ago(p.crm_called_at) + (p.crm_calls > 1 ? ` · ${p.crm_calls} appels` : '') + ' · ';
            const u = document.createElement('a'); u.href = '#'; u.textContent = 'effacer'; u.className = 'link';
            u.addEventListener('click', e => { e.preventDefault(); send({ call: 'undo' }, { crm_call_result: null, crm_called_at: null, crm_calls: 0 }); });
            info.appendChild(u);
        } else info.textContent = 'Pas encore appelé';
        a.appendChild(info);
        return a;
    }

    // Numéro au format WhatsApp (33...) : le premier portable (06 / 07) du champ téléphone.
    function waNumber(tel) {
        const nums = String(tel || '').split(/[\/,;]| ou /).map(x => x.replace(/[^\d+]/g, '')).filter(Boolean);
        const norm = n => n.startsWith('+') ? n.slice(1) : n.startsWith('00') ? n.slice(2) : n.startsWith('0') ? '33' + n.slice(1) : n;
        const all = nums.map(norm).filter(n => n.length >= 11);
        return all.find(n => /^33[67]/.test(n)) || null;
    }
    // Message prérempli selon où en est le prospect. Jamais de « on a vu que vous avez visité le site ».
    // Chaque WhatsApp part avec un exemple concret de dossier (règle du gérant, 16 nov. 2026).
    // Clôture, pergola, abri, piscine, véranda : une déclaration préalable. Extension, maison, garage : un permis.
    function waExample(p) {
        const m = ((p.metier || '') + ' ' + (p.crm_notes || '')).toLowerCase();
        const B = 'https://urbatik.com/img/exemples/';
        if (/carport|garage|balcon/.test(m)) return { label: 'permis carport et balcon', url: B + 'permis-carport-balcon.pdf', file: 'Urbatik - Exemple permis de construire.pdf' };
        if (/extension|sur[ée]l[ée]v|maison|constructeur|agrandis/.test(m)) return { label: 'permis surélévation et extension', url: B + 'permis-surelevation-extension.pdf', file: 'Urbatik - Exemple permis de construire.pdf' };
        return { label: 'déclaration préalable (préau)', url: B + 'declaration-preau.pdf', file: 'Urbatik - Exemple declaration prealable.pdf' };
    }
    function waMessage(p) { return waText(p) + '\n\nUn exemple de dossier qu\'on a fait : ' + waExample(p).url; }
    function waText(p) {
        const h = parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }), 10);
        const hello = h >= 18 ? 'Bonsoir' : 'Bonjour';
        const first = (p.nom || '').trim().split(/\s+/)[0] || '';
        const who = first ? hello + ' ' + first : hello;
        const m = (p.metier || '').toLowerCase();
        const pour = /piscin/.test(m) ? ' pour vos piscines' : /pergol|v[ée]rand/.test(m) ? ' pour vos pergolas et vérandas' : /abri|bois/.test(m) ? ' pour vos constructions bois' : /cl[oô]tur|portail/.test(m) ? ' pour vos clôtures et portails' : /fen[eê]tre|menuis/.test(m) ? ' pour vos menuiseries' : '';
        if (p.crm_status === 'pas_repondu' || p.crm_call_result === 'no_answer')
            return `${who}, c'est Eliasse d'Urbatik. J'ai essayé de vous joindre au sujet de vos dossiers de mairie${pour}. Quand puis-je vous rappeler ? Sinon, la demande se fait en ligne en 2 minutes sur urbatik.com.`;
        if (p.crm_call_result === 'ok' || p.crm_status === 'rappel')
            return `${who}, c'est Eliasse d'Urbatik, suite à notre échange. Avez-vous un chantier qui aurait besoin d'une déclaration préalable ou d'un permis ? On s'occupe de tout le dossier. Dites-moi quand je peux vous rappeler.`;
        if (p.crm_status === 'lien_envoye' || p.crm_status === 'rdv')
            return `${who}, c'est Eliasse d'Urbatik. Avez-vous des questions pour démarrer votre premier dossier ? Je peux vous répondre ici ou vous appeler.`;
        return `${who}, c'est Eliasse d'Urbatik, suite à nos échanges par email sur les dossiers de mairie${pour}. Avez-vous des questions avant de vous lancer sur un premier dossier ? Je peux vous répondre ici, ou vous appeler si vous préférez.`;
    }

    function render() {
        const list = $('list'); list.textContent = '';
        const rows = visible();
        if (!rows.length) {
            const e = document.createElement('div'); e.className = 'empty';
            e.textContent = filter === 'today'
                ? "Personne aujourd'hui pour l'instant. Dès qu'un prospect clique sur le lien d'un email, il apparaît ici en vert."
                : 'Aucun prospect.';
            list.appendChild(e); return;
        }
        rows.forEach(p => list.appendChild(card(p)));
    }

    async function load() {
        const r = await api('crm_list');
        const fresh = r.prospects || [];
        if (seen) {
            const before = Object.fromEntries(seen.map(p => [p.email, p.last_visit_at]));
            const newVisit = fresh.find(p => p.last_visit_at && p.last_visit_at !== before[p.email]);
            if (newVisit) announce(newVisit);
        }
        seen = fresh;
        data = fresh;
        $('liveTxt').textContent = 'À jour · ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (!editing) render();
    }

    async function start() {
        if (!token) return show('login');
        $('logout').hidden = false; show('main');
        try { await load(); } catch (e) { if (e.message !== 'session') alertMsg('Erreur de chargement.'); }
    }
    setInterval(() => { if (token && !document.hidden) load().catch(() => { $('liveTxt').textContent = 'Hors ligne, nouvel essai…'; }); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && token) load().catch(() => {}); });
    window.addEventListener('focus', () => { document.title = 'Prospects · Admin Urbatik'; });

    $('addBtn').addEventListener('click', () => $('addDlg').showModal());
    $('addForm').addEventListener('submit', async e => {
        if (e.submitter && e.submitter.value === 'cancel') return;
        e.preventDefault();
        const email = $('aEmail').value.trim().toLowerCase();
        if (!email) return;
        try {
            await api('crm_update', { email, create: true, fields: { nom: $('aNom').value, entreprise: $('aEnt').value, tel: $('aTel').value, crm_status: 'a_appeler' } });
            $('addDlg').close(); e.target.reset(); await load();
        } catch (x) { alertMsg("Impossible d'ajouter ce prospect."); }
    });

    start();
})();
