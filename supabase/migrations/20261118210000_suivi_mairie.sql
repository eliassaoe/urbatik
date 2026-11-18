-- Suivi jusqu'à l'accord de la mairie (décision du gérant, 18 nov. 2026). Voir docs/suivi-mairie.md.
-- Après la livraison, la page /suivi demande « La mairie a accepté ? Oui / Non ». Sans réponse, le dossier
-- passe en « accordee » (presumee) au bout de PRESUME_JOURS ; le client peut toujours dire « Non » ensuite,
-- ce qui remet le dossier en « a_retravailler » (on le reprend sans frais).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status = any (array[
  'en_attente_paiement','payee','en_preparation','en_relecture','livree','deposee',
  'a_retravailler','accordee','refusee','annulee','remboursee']));
alter table public.orders
  add column if not exists livree_at timestamptz,
  add column if not exists deposee_at timestamptz,
  add column if not exists decision_at timestamptz,
  add column if not exists decision_presumee boolean not null default false,
  add column if not exists mairie_reminders_sent int not null default 0,
  add column if not exists last_mairie_reminder_at timestamptz;
