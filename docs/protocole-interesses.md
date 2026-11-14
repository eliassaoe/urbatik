# Ne perdre aucun intéressé (14 nov. 2026)

Règle du gérant : un artisan intéressé qui n'achète pas tout de suite ne doit pas être perdu.

## Ce qui tourne
1. **Relance des formulaires abandonnés** — fonction `dossier-abandons`, job pg_cron `dossier-relances-abandons`
   (toutes les heures, minute 17). Cible : `dossier_clients` avec `offer_started_at` (email laissé au dernier écran),
   sans commande payée, non désinscrit, depuis moins de 30 jours. 3 emails :
   - +1 h « Votre dossier de mairie est prêt à partir » (lien /commande)
   - +24 h « Une question avant de lancer votre dossier ? » (prix fixe, remboursé si refus, photos après)
   - +7 j « Pas de chantier en ce moment ? » (garder l'email, phrase à mettre dans les devis, appel 15 min)
   Liens taggés `utm_source=relance&utm_content=r1|r2|r3` (visible dans PostHog). Arrêt automatique dès qu'il paie.
   Désinscription : la personne répond STOP → mettre `dossier_clients.unsubscribed_at = now()`.
   Les adresses @linkfinderai.com (tests) sont ignorées.
2. **Leads Explee** : leurs emails restent dans Explee (projet creha.fr 61157) ; chaque réponse donne le site puis le Calendly.

## À faire ensuite (proposé, pas encore construit)
- Vérification gratuite « Pas de chantier en ce moment ? » : adresse + type de travaux → réponse DP/PC + contraintes PLU.
- Relance mensuelle de tous les intéressés non acheteurs (Explee + formulaire).
