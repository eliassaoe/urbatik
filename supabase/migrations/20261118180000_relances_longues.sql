-- Relances longues (18 nov. 2026, décision du gérant) : prospects qui ont répondu à la prospection creha,
-- et alerte au gérant quand un prospect connu revient sur le site. Voir docs/relances-longues.md.
alter table public.dossier_clients
    add column if not exists replied_at timestamptz,
    add column if not exists reply_nurture_sent integer not null default 0,
    add column if not exists last_reply_nurture_at timestamptz,
    add column if not exists priority_alert_at timestamptz;
