# Vérification du PLU avant le paiement (18 nov. 2026, décision du gérant)

« Si le projet n'est pas viable, on le dit avant même que le client paye. Sinon il paye, on rembourse, et c'est rien. »

## Parcours
1. Le client décrit son projet dans `/commande` (type, ouvrage, adresse, surface, hauteur, dimensions, distances, matériaux).
   En quittant l'écran « existant », le formulaire appelle `plu-check` (`start`) ; la vérification tourne pendant qu'il
   remplit la suite (photos, client, entreprise, contact).
2. Sur le dernier écran, un bloc « PLU » :
   - en cours → « On vérifie votre projet avec le PLU de … » ; bouton de paiement désactivé (3 min maximum, ensuite on rend la main) ;
   - ✅ **viable** → paiement normal ;
   - 🟠 **à vérifier** (donnée manquante, avis ABF…) → points listés, paiement possible ;
   - ⛔ **non viable** → explication (règle, article, chiffre du projet), « Pour qu'il passe : … », boutons
     **Modifier mon projet** (retour à l'écran taille) et WhatsApp ; **paiement bloqué**. Si le client corrige, la
     vérification repart toute seule.
   - inconnu (adresse introuvable, service en panne) → paiement possible, PLU vérifié à la génération.

## Comment
- `supabase/functions/plu-check` : géocodage (BAN), Géoportail de l'Urbanisme (zone, document, servitudes AC1/AC2/AC4 =
  ABF, PPR, prescriptions), puis analyse IA du règlement (OpenRouter, `PLU_MODEL` ou `VISION_MODEL`).
- Le PDF du règlement (souvent 300+ pages) est lu par GitHub Actions (`.github/workflows/plu-extract.yml`,
  `generateur/plu_extract.py`, même extraction que le générateur) puis mis en cache par zone
  (`plu_reglement_cache`) : ~70 s la première fois dans une zone, ~40 s ensuite.
- Tables `plu_checks` (une ligne par vérification, verdict + résultat) et `plu_reglement_cache`. Même saisie dans les
  7 jours = même résultat (pas de second appel IA). Plafond : 400 vérifications par 24 h.
- Événement PostHog : `dossier_express_plu_result` {verdict, zone}, `dossier_express_plu_modify`.

Après paiement, le générateur refait une vérification complète avec les mesures de la fiche technique (`generateur/plu.py`).

Premier essai réel (pergola 3,6 m, PLUi Le Mans Métropole, U mixte 1) : « à vérifier » — hauteur limitée à 3 m à l'égout
si la pergola est classée annexe, et 3,50 m en limite au-delà de 20 m de la rue ; distance à la rue manquante.

## 19 nov. 2026 : le « à vérifier » ne doit pas faire fuir
Un vérandaliste (Colomiers, 18 m²) a rempli les 17 étapes à minuit, a vu « à vérifier… Faire confirmer ces points par le service urbanisme de Colomiers avant de payer », et est parti sans payer. Le texte de la zone UM7 n'avait pas été extrait (seul le sommaire du PLUi de Toulouse Métropole), d'où une liste de devoirs.
Correction : dans le formulaire, un « à vérifier » s'affiche « ✅ Rien ne bloque d'après vos chiffres » + les thèmes qu'Urbatik vérifie lui-même, sans la liste `que_faire`. La consigne de l'IA interdit désormais « consultez la mairie avant de payer ». Reste à faire : extraire la bonne partie des règlements découpés par zone (PLUi de grandes métropoles).
