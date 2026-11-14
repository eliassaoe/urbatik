-- Relance des visiteurs qui ont laissé leur email au dernier écran sans payer (fonction dossier-abandons).
alter table public.dossier_clients
  add column if not exists abandon_reminders_sent int not null default 0,
  add column if not exists last_abandon_reminder_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;
