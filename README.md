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

## Backend (tout est ici depuis le 14 nov. 2026)

Le site et tout ce qui le fait tourner vivent dans ce dépôt, plus rien dans `findlinkai`.

| Quoi | Où |
| --- | --- |
| Edge Functions Supabase (`create-order`, `dodo-webhook`, `client-order`, `dossier-relances`, `admin-dossiers`) | `supabase/functions/`, code commun dans `_shared/dossier-express.ts` |
| Tables (`orders`, `order_files`, `dossier_clients`, `dossier_avis`, `dossier_settings`…) | `supabase/migrations/` (déjà appliquées au projet `snxhsboboatjywgwdeds`) |
| Réglages (SITE_URL = https://urbatik.com, produits Dodo, webhook n8n, mot de passe admin) | table privée `dossier_settings`, jamais dans ce dépôt public |
| Réponses automatiques Explee (projet creha.fr 61157) | `docs/explee/` |

Déploiement : chaque fonction se déploie avec `--no-verify-jwt` et le dossier `_shared` à côté.
Ne pas utiliser `supabase db push` : le projet Supabase porte aussi d'autres migrations.

Liens : site https://urbatik.com, suivi client `/suivi?token=…`, avis `/avis?token=…`, merci `/merci`, admin `/admin/dossiers`.
Les anciennes adresses `/declaration-prealable/*` (ici et sur linkfinderai.com) redirigent vers ces pages.
