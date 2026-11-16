-- Suivi commercial (page /admin/prospects) : statut d'appel, prochaine action, date de relance, notes.
alter table public.dossier_clients
  add column if not exists crm_status text not null default 'a_appeler',
  add column if not exists crm_next text,
  add column if not exists crm_relance date,
  add column if not exists crm_notes text,
  add column if not exists crm_said text,
  add column if not exists metier text,
  add column if not exists crm_updated_at timestamptz;
-- Boutons « Appelé / Pas répondu » et « Terminé ».
alter table public.dossier_clients
  add column if not exists crm_called_at timestamptz,
  add column if not exists crm_call_result text,
  add column if not exists crm_calls int not null default 0,
  add column if not exists crm_done_at timestamptz;
