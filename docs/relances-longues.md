# Relances longues des prospects (18 nov. 2026, décision du gérant)

« Il faut les relancer 6, 7, 8 fois sur les mois qui viennent. Celui qui a visité le site doit être priorisé de fou. »
Le chantier arrive quand il arrive : on reste présent jusqu'à ce qu'il y en ait un.

Tout tourne dans Supabase (pas dans PostHog : PostHog n'a qu'un expéditeur vérifié, support@linkfinderai.com ;
envoyer au nom de LinkFinder à des artisans serait incompréhensible). Envoi par le webhook n8n habituel
(`N8N_EMAIL_WEBHOOK`), au nom d'Urbatik. Arrêt automatique dès qu'une commande est payée.

| Qui | Combien | Quand (après…) | Où |
| --- | --- | --- | --- |
| A. A laissé son email au dernier écran du formulaire | 3 | +1 h, +24 h, +7 j (l'abandon) | `dossier-abandons` |
| B. **A visité le site** par un lien perso (`?e=`) | **10** | +3 h, +2 j, +5 j, +10 j, +21 j, +35 j, +55 j, +80 j, +110 j, +150 j (la 1re visite) | `dossier-abandons` |
| C. A répondu à la prospection (lead « Hot » Explee, projet creha 61157), pas encore venu | **8** | +10 j, +17 j, +25 j, +40 j, +60 j, +85 j, +115 j, +150 j (sa réponse) | `dossier-abandons` |

C passe à B dès qu'il visite. B s'arrête si A commence.
C commence à +10 j pour laisser passer les relances courtes de la page `/relance` (J+1 à J+8).

**Priorité aux visiteurs** : `dossier-visit` envoie au gérant (`ADMIN_EMAIL`) un email « 🔥 À appeler » quand un prospect
qui a répondu vient sur le site, ou quand un visiteur revient (2e visite et plus) — nom, entreprise, téléphone, page.
Au plus un par 12 h et par prospect. `js/site.js` compte aussi les retours sans `?e=` (email gardé dans le navigateur),
une fois par session.

**D'où viennent les prospects C** : la page `/relance` du dépôt findlinkai (`relance.html`, reconstruite toutes les 2 h
depuis l'API Explee) est lue par `syncExplee()` à chaque passage horaire. Pas de clé Explee côté Supabase.
Exclus : lead « perdu », dernier message avec stop / désinscription / pas intéressé. Prénom utilisé seulement si
Explee en a un (sinon « Bonjour, »).

**Désinscription** : « répondez STOP » en bas de chaque email → mettre `unsubscribed_at` sur la ligne `dossier_clients`.

Colonnes ajoutées (migration `20261118180000_relances_longues.sql`) : `replied_at`, `reply_nurture_sent`,
`last_reply_nurture_at`, `priority_alert_at`.

Premier passage (18 nov., 18 h 50) : 32 prospects importés, 5 déjà venus sur le site (suite B), 5 premiers emails C envoyés
(réponses du 2 au 8 nov.).
