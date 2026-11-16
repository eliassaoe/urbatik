-- Suivi commercial (page /admin/prospects) : statut d'appel, prochaine action, date de relance, notes.
alter table public.dossier_clients
  add column if not exists crm_status text not null default 'a_appeler',
  add column if not exists crm_next text,
  add column if not exists crm_relance date,
  add column if not exists crm_notes text,
  add column if not exists crm_said text,
  add column if not exists metier text,
  add column if not exists crm_updated_at timestamptz;
