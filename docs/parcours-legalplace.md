# Le parcours LegalPlace, relevé le 20 nov. 2026 (modèle à reproduire pour Urbatik)

Gérant, 20 nov. 2026 : « fais tout comme LegalPlace, copie-les absolument ». On reprend leur
mécanique (étapes, ordre des questions, page de formules, récap de paiement, garanties), pas
leurs textes ni leur marque, et on n'affiche que nos vrais chiffres (aucun avis ni compteur inventé).

Parcours fait en entier le 20 nov. sur legalplace.fr (création de SASU), sans payer, avec la boîte de
test `unlimitedlead.test.inbox@gmail.com` (pour voir leurs relances ensuite).

## 1. Page d'entrée
- Promesse + prix d'appel : « Créez votre entreprise ultra rapidement dès 0 € » (+ frais obligatoires).
- Sous-titre humain : « Accompagnement complet par un formaliste dédié jusqu'à l'obtention du Kbis ».
- Première question posée directement sur la page : « Quel sera votre domaine d'activité ? », en tuiles
  avec icônes (12 choix). Cliquer une tuile lance le questionnaire.
- Preuves sous les tuiles : note Google 4,5/5, Trustpilot 4,4, « +300 000 sociétés accompagnées ».
- « Comment ça marche ? » en 6 étapes, du questionnaire jusqu'à « vous pouvez démarrer ».
- « Pourquoi nous faire confiance ? » : construit par des avocats, données en sécurité, satisfait ou remboursé.
- Tableau « Et si je le fais moi-même ? » : LegalPlace / avocat / expert-comptable / soi-même, sur le
  prix (0 € / > 1 200 € / > 800 € / frais), la rapidité (24 h / > 1 semaine), la complexité
  (formulaire de 5 min / allers-retours / tout rédiger seul) et les avantages.
- Longue FAQ et guide SEO en bas.

## 2. Questionnaire de qualification (≈ 13 écrans, barre de progression en tirets)
- Téléphone cliquable en haut à droite sur chaque écran.
- Une question par écran, en tuiles à icônes : seul ou à plusieurs → statut → **dans quel délai ?
  (dès que possible / dans la semaine / dans le mois / je ne sais pas)** → nom de la société → domaine →
  président → identité → associés → capital → siège → expert-comptable.
- Presque chaque champ a un lien **« Saisir plus tard »** / « Choisir plus tard » : on ne bloque jamais.
- Un encart « À savoir » sous les questions techniques (explique sans jargon).
- **Email au 11e écran** : « Nous avons besoin de votre adresse mail pour sauvegarder vos réponses et
  finaliser votre dossier » (+ « Vos données sont en sécurité »).
- **Téléphone au 12e écran** : « Lorsque nous avons besoin de précisions supplémentaires sur votre dossier,
  nous vous joindrons par téléphone ». Facultatif (on peut continuer sans).
- Dernier écran : « Que recherchez-vous ? » (cases : tout déléguer / seulement les statuts / tout-en-un /
  du conseil / je me renseigne) : sert à recommander la formule.

## 3. « D'après vos précédentes réponses, voici ce que nous vous recommandons »
- Une formule mise en avant (« Choisie par 7 entrepreneurs sur 10 »), prix, liste de ce qui est inclus,
  bouton, et des lignes « Inclus / Non inclus ».
- « Voir toutes les formules » : 3 colonnes, Basique 0 € (vous faites, on envoie) / Express 199 € HT
  (un formaliste fait tout, prioritaire 24 h, garantie anti-rejet) / Premium (tout + gestion, mis en avant).
- FAQ de la page : **comment marche la garantie anti-rejet** (ce qui est couvert, ce qui ne l'est pas),
  **que se passe-t-il après le paiement** (questionnaire complémentaire, pièces, puis les experts).

## 4. « Récapitulons votre commande. »
- Chaque ligne de la commande avec sa liste de cases cochées (ce qui est fait pour vous).
- Frais obligatoires séparés, expliqués.
- Options « personnalisez votre offre après le paiement ».
- **Deux modes de paiement** : « Payer maintenant » (remise de 30 € + 4 bonus offerts) ou
  **« Payer une partie aujourd'hui »** (seulement la prestation, le reste plus tard).
- Sous le bouton : frais récupérables, **« Accès immédiat à votre dossier »** (ce qui se passe juste
  après), aide par téléphone 9 h-18 h.

## 5. Après le paiement
Questionnaire complémentaire, pièces justificatives, puis le formaliste dépose et suit jusqu'au Kbis.
**On paie avant le travail détaillé, pas après un aperçu** : la confiance vient de l'humain affiché
(formaliste dédié, RDV offert, téléphone partout), de la garantie anti-rejet et des preuves sociales.

## Ce que ça donne pour Urbatik
Notre parcours actuel (formulaire court → paiement → fiche technique sur /suivi) a déjà le même ordre.
Ce qui manque, dans l'ordre d'impact : voir le plan dans la conversation du 20 nov. et le suivi en bas de ce
fichier une fois construit.

## Ce qui a été construit (20 nov. 2026)
- **Accueil** : prix d'appel, « un conseiller dédié jusqu'à l'accord », première question en tuiles
  (`/commande?ouvrage=…` démarre au délai), 5 étapes, tableau « Et si je le fais moi-même ? »
  (fourchettes architecte/dessinateur sourcées Cedreo), garantie anti-refus avec ce qui est couvert ou non,
  téléphone dans l'en-tête.
- **Questionnaire** (`commande.html`) : type → travaux → **délai** → adresse → **email seul** (sauvegarde des
  réponses côté serveur, comme LegalPlace) → **coordonnées** (entreprise et téléphone facultatifs) →
  **« Que recherchez-vous ? »** → **« D'après vos réponses, voici ce que nous vous recommandons »** + « Voir toutes
  les formules » → **« Récapitulons votre commande. »** avec « Payer maintenant » / « Payer une partie aujourd'hui ».
  Téléphone visible sur chaque écran.
- **Formules** (prix HT, mêmes valeurs dans `PRIX` du code partagé et dans `commande.html`) :
  Essentiel 199 € / 329 € (dossier seul), Pro 249 € / 390 € (relu, suivi, garantie), Premium 349 € / 490 €
  (prioritaire 48 h, appel de cadrage, modifications illimitées). « Payer maintenant » garde l'offre -30 %.
- **Acompte** : 49 € HT à la commande, solde à la livraison (bouton sur /suivi, rappel dans l'email de livraison,
  « SOLDE DÛ » dans l'admin, webhook `paiement: 'solde'`).

## Ce qui attend le gérant
Essentiel, Premium et l'acompte demandent un montant libre chez Dodo. Tant qu'ils ne sont pas réglés, le site ne
montre et n'encaisse que **Pro** (249 € / 390 €), et l'accueil affiche « à 249 € HT » au lieu de « dès 199 € ».
1. Dodo → Produits → nouveau produit **à paiement unique, « Pay What You Want » activé**, prix minimum 1 €,
   nom « Urbatik – dossier de mairie ». Mettre son id (`pdt_…`) dans `dossier_settings` sous `DODO_PRODUCT_LIBRE`.
2. Dodo → Developer → API Keys → créer une clé, la coller dans **Supabase → Edge Functions → Secrets** sous
   `DODO_API_KEY` (jamais dans le chat ni dans Git).
3. Redéployer `client-order`, `dodo-webhook` et `admin-dossiers` (le code est prêt dans le dépôt, seul
   `create-order` a été déployé le 20 nov.).
Vérifier ensuite `create-order {action:'health'}` : `DODO_API_KEY` et `DODO_PRODUCT_LIBRE` à `true`.

À confirmer par le gérant : la promesse Premium « livré en 48 h » et « appel de cadrage » (engagements de service).
