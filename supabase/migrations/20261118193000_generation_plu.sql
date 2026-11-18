-- Vérification d'urbanisme automatique (generateur/plu.py) : faits du Géoportail de l'Urbanisme + analyse IA du règlement.
alter table public.dossier_generations add column if not exists plu jsonb;
