-- Fiche technique remplie par l'artisan sur /suivi après la commande : les mesures dont le
-- générateur de dossiers a besoin (docs/generateur/donnees-necessaires.md).
alter table public.orders add column if not exists fiche_technique jsonb;
alter table public.orders add column if not exists fiche_technique_at timestamptz;

-- Photos des 4 façades et de l'emplacement (dessin des façades et insertion paysagère).
alter table public.order_files drop constraint if exists order_files_kind_check;
alter table public.order_files add constraint order_files_kind_check check (kind = any (array[
  'photo_facade','photo_ensemble','photo_rue','plan_ou_devis','complement',
  'facade_avant','facade_arriere','facade_gauche','facade_droite','photo_emplacement']));
