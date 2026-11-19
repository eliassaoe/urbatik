-- « C'est quand votre prochain chantier ? Quand aurez-vous besoin du dossier ? » (gérant, 19 nov. 2026).
-- L'intérêt est réel mais pas urgent : on note la date du besoin et on revient à ce moment-là.
-- dossier-abandons (suite D) écrit au prospect 7 jours avant la date, et prévient le gérant pour qu'il appelle.
alter table public.dossier_clients
  add column if not exists prochain_chantier date,
  add column if not exists prochain_chantier_quoi text,
  add column if not exists chantier_relance_sent int not null default 0,
  add column if not exists chantier_relance_at timestamptz;
