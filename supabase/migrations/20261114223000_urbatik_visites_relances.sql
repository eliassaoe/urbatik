-- Visites identifiées (lien Explee avec l'email du prospect) et relances "nurture" (fonction dossier-abandons).
alter table public.dossier_clients
  add column if not exists visited_at timestamptz,
  add column if not exists last_visit_at timestamptz,
  add column if not exists visits int not null default 0,
  add column if not exists source text,
  add column if not exists nurture_sent int not null default 0,
  add column if not exists last_nurture_at timestamptz;
