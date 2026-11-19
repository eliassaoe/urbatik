-- Formulaire court (gérant, 19 nov. 2026 : « il faut que le paiement soit super simple ») : avant de payer on ne demande
-- plus que le type de dossier, l'ouvrage, l'adresse et le contact. Le reste se remplit après le paiement sur /suivi
-- (fiche technique), qui recopie ces valeurs dans les colonnes de la commande.
alter table public.orders
  alter column nom_client_final drop not null,
  alter column dimensions drop not null,
  alter column distance_limites drop not null,
  alter column materiaux drop not null,
  alter column couleurs drop not null,
  alter column surface_m2 drop not null,
  alter column hauteur_m drop not null,
  alter column terrain_modifie set default false;
