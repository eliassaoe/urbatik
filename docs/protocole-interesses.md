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
2. **Lien personnalisé (14 nov. 21:45)** : chaque réponse Explee (projet creha.fr 61157) donne
   `https://urbatik.com/?utm_source=cold_email&utm_campaign=creha&e={email du prospect}` puis le Calendly avec `?email=`.
   Sur le site, `js/site.js` lit `e`, garde l'email (localStorage `urbatik_email`), pré-remplit le formulaire,
   identifie la personne dans PostHog, enregistre la visite (fonction `dossier-visit` → `dossier_clients.visited_at`)
   puis retire l'email de l'URL. Vérifié en ligne le 14 nov.
3. **Relances « nurture »** des visiteurs identifiés qui ne vont pas jusqu'au dernier écran (même fonction
   `dossier-abandons`) : 6 emails à +3 h, +2 j, +7 j, +21 j, +45 j, +75 j (lancer un dossier, comment ça marche + tarifs,
   appel 15 min, pas de chantier, chantier bientôt, dernier message). S'arrête si paiement ou si la personne atteint le
   dernier écran (la suite « abandon » prend le relais).
4. **WhatsApp** : bouton flottant (sauf /commande) et numéro en pied de page, 06 26 34 44 75.

## À faire ensuite (proposé, pas encore construit)
- Vérification gratuite « Pas de chantier en ce moment ? » : adresse + type de travaux → réponse DP/PC + contraintes PLU.
