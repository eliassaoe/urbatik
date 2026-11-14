# Urbatik – urbatik.com

Site public d'Urbatik (dossiers de mairie pour artisans), servi par GitHub Pages sur urbatik.com.

| Page | Fichier |
| --- | --- |
| Accueil | `index.html` |
| Formulaire (une question par écran, paiement à la fin) | `commande.html` |
| Merci (retour de Dodo) | `merci.html` |
| Suivi client (`/suivi?token=…`) | `suivi.html` |
| Admin (mot de passe) | `admin/dossiers.html` + `admin/dossiers.js` |

`declaration-prealable/*.html` sont des redirections : les Edge Functions Supabase construisent encore
les liens `…/declaration-prealable/merci` et `…/declaration-prealable/suivi`.

Le serveur (Edge Functions `create-order`, `dodo-webhook`, `client-order`, `admin-dossiers`,
`dossier-relances`, tables `orders`, `order_files`, `dossier_clients`, `dossier_settings`) vit dans le dépôt
`eliassaoe/findlinkai` (`supabase/functions/`). Aucun secret ici : la clé Supabase de ces pages est la clé publique.
