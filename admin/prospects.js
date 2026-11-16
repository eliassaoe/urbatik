// Suivi des prospects Urbatik (/admin/prospects). Même connexion que /admin/dossiers (jeton dans ce navigateur).
// La liste se recharge toute seule toutes les 20 secondes : une visite du site par un prospect (lien de l'email
// avec son adresse) le fait remonter en haut, en vert, avec une alerte.
(function () {
    'use strict';
    const API = 'https://snxhsboboatjywgwdeds.supabase.co/functions/v1/admin-dossiers';
    const KEY = 'urbatik_admin_token';
    const REFRESH_MS = 20000;
    const $ = id => document.getElementById(id);
    const STATUS = [['a_appeler', 'À appeler'], ['rappel', 'Rappel prévu'], ['pas_repondu', 'Pas répondu'],
        ['lien_envoye', 'Lien envoyé'], ['rdv', 'Rendez-vous'], ['client', 'Client'], ['perdu', 'Perdu']];
    const CLOSED = ['client', 'perdu'];

    let token = ''; try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
    let filter = 'today', data = [], seen = null, editing = 0, notif = false;

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
            || (p.crm_relance && p.crm_relance <= t && !CLOSED.includes(p.crm_status));
    }
    function visible() {
        let rows = data;
        if (filter === 'today') rows = rows.filter(isToday);
        if (filter === 'visited') rows = rows.filter(p => p.last_visit_at);
        if (filter === 'todo') rows = rows.filter(p => !CLOSED.includes(p.crm_status));
        return rows.slice().sort((a, b) => {
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
        d.className = 'p' + (recent ? ' hot' : '') + (CLOSED.includes(p.crm_status) ? ' done' : '');

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

        if (p.crm_said) { const s = document.createElement('div'); s.className = 'said'; s.textContent = '« ' + p.crm_said + ' »'; d.appendChild(s); }
        if (p.orders && p.orders.length) {
            const o = document.createElement('div'); o.className = 'meta';
            o.textContent = p.orders.some(x => x.paid) ? '✅ A payé un dossier' : '🟠 A rempli le formulaire sans payer';
            d.appendChild(o);
        } else if (p.offer_started_at) {
            const o = document.createElement('div'); o.className = 'meta'; o.textContent = '🟠 A commencé le formulaire de commande ' + ago(p.offer_started_at); d.appendChild(o);
        }

        const f = document.createElement('div'); f.className = 'fields';
        const st = document.createElement('select');
        STATUS.forEach(([k, l]) => st.add(new Option(l, k)));
        st.value = p.crm_status || 'a_appeler';
        hook(st, p, 'crm_status');
        f.append(field('Statut', st), field('Prochaine action', input(p, 'crm_next')), field('Relance le', input(p, 'crm_relance', 'date')));
        d.appendChild(f);

        const f2 = document.createElement('div'); f2.className = 'fields2';
        f2.append(field("Notes d'appel", input(p, 'crm_notes', 'area')), field('Téléphone', input(p, 'tel')));
        d.appendChild(f2);

        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = p.email + (p.source ? ' · ' + (p.source === 'email_creha' ? 'campagne email' : p.source) : '') + ' ';
        const saved = document.createElement('span'); saved.className = 'saved'; meta.appendChild(saved);
        d.appendChild(meta);
        return d;
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
