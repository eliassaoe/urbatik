-- Demande remplie mais pas payée (19 nov. 2026) : on garde les réponses du formulaire côté serveur, pour que chaque
-- relance contienne un lien qui rouvre la demande déjà remplie (?d=), quel que soit l'appareil.
-- Le gérant : « t'aurais dû lui envoyer le lien rempli direct ».
alter table public.dossier_clients add column if not exists draft jsonb, add column if not exists draft_at timestamptz;
