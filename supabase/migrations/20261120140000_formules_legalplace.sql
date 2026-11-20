-- Parcours à la LegalPlace (20 nov. 2026, docs/parcours-legalplace.md) :
-- trois formules, le délai souhaité, et « payer une partie aujourd'hui » (acompte, solde à la livraison).
alter table public.orders
  add column if not exists formule text not null default 'pro',
  add column if not exists delai_souhaite text,
  add column if not exists paiement_mode text not null default 'total',
  add column if not exists acompte_cents integer,
  add column if not exists solde_paid_at timestamptz,
  add column if not exists solde_payment_id text;

alter table public.orders drop constraint if exists orders_formule_check;
alter table public.orders add constraint orders_formule_check check (formule in ('essentiel', 'pro', 'premium'));
alter table public.orders drop constraint if exists orders_paiement_mode_check;
alter table public.orders add constraint orders_paiement_mode_check check (paiement_mode in ('total', 'acompte'));

alter table public.dossier_clients add column if not exists delai_souhaite text;
