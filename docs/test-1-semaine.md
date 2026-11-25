# Test d'une semaine : est-ce que ça marche ? (lancé le 14 nov. 2026)

Décision du gérant : ~200 $ sur 7 jours, verdict à la fin de la semaine. Pas plus d'une semaine.

## Réglages
- Explee, projet creha.fr (61157) uniquement : budget **29 $/jour** (= 203 $ / 7 j), 9 campagnes relancées
  (toutes les niches, pour savoir laquelle achète). À 0,03 $ l'email : ~970 emails/jour.
- Paiement Dodo en **réel** depuis le 14 nov. 20:32 (produits live, webhook live vérifié, prix 249 € HT affiché).
- Chaque réponse Explee : le site d'abord, puis le Calendly (appels pour comprendre les attentes).

## Point de départ (mesuré le 14 nov.)
2 692 emails envoyés, 1,9 % de réponses, **17 leads intéressés à 4,75 $** pièce
(16 sur la campagne Vérandalistes & Pergolistes, les autres niches presque pas testées).

## Ce qu'on attend en 7 jours (~6 700 emails)
~40-50 leads intéressés (au taux actuel de 0,63 % des emails). Commandes attendues selon le taux de conversion
lead intéressé → commande : 2 % → ~1 ; 5 % → ~2 ; 12 % → ~5.
Attention : les réponses arrivent avec 1 à 5 jours de retard (relances), et un artisan ne commande que s'il a un
chantier. Les commandes des derniers jours tomberont la semaine suivante.

## Règle de décision (dimanche 22 nov.)
| Résultat de la semaine | Verdict |
| --- | --- |
| 0 commande **et** moins de 3 appels Calendly | Ça ne marche pas tel quel : changer l'offre ou la cible avant de dépenser plus |
| 0 commande mais 3 appels ou plus | Le besoin existe, le parcours bloque : écouter les appels, corriger, relancer une semaine |
| 1 à 2 commandes | Ça marche à petite échelle : garder, améliorer la niche qui convertit |
| 3 commandes ou plus | Ça marche : augmenter le budget sur la niche gagnante |

À regarder aussi : quelle niche donne les leads, combien de leads vont sur le site (PostHog, utm_campaign=creha),
où ils abandonnent le formulaire (tableau de bord PostHog « Urbaa – parcours de commande »).

## Changement de ciblage (14 nov. 21:05, décision du gérant)
Avant : 3 ou 5 salariés minimum, artisans seuls exclus. Maintenant : **à partir de 1 salarié, artisans seuls inclus**,
sur les 10 campagnes (profil par défaut + les 5 ciblages personnalisés). Raison : un artisan seul ou à 2-3 n'a
personne pour l'administratif, donc le besoin est plus urgent. À comparer dimanche : taux de leads intéressés
avant/après, et taille des entreprises qui commandent.

## Focus semaine 1 (14 nov. 21:45, décision du gérant)
Seulement les meilleures niches : Vérandalistes & Pergolistes (+ « similar companies »), Piscinistes, Abris de jardin,
Abris/studios & constructions bois, Clôturistes & portails. **Façadiers mis en pause** ; Photovoltaïque et Paysagistes
restent « en revue », non approuvés (aucun envoi). Studios de jardin : en pause par Explee, 0 envoi.
Plafonds par campagne au moment du changement : Vérandalistes 12 $, Abris de jardin 5 $, les 4 autres 3 $ (total 29 $/jour).
Les autres niches viendront en semaine 2.

## Verdict du 22 nov. 2026 (lu automatiquement, 10:00)
Chiffres du 15 au 22 nov. :
- **Commandes payées : 0.** Une commande abri de jardin créée le 17/11, jamais payée ; une véranda créée le 20/11, annulée.
- **Prospects qui ont répondu : 41** (34 réponses Explee + 7 depuis les emails creha). Vérandalistes & Pergolistes 23 ;
  abris, studios et constructions bois 8 ; piscinistes 5 ; clôturistes 3 ; autres 2.
- Venus sur le site : 10 personnes (PostHog, utm_campaign=creha). 2 ont ouvert le formulaire, 1 a cliqué « commander »,
  1 véranda a rempli les 17 étapes sans payer.
- **Appels qui ont eu lieu : 4** (2 vérandalistes, 1 pisciniste « intéressé, rappelle », 1 abris parti sur le prix du permis à 790 €, baissé à 390 € le soir même).
  Calendly : pas lu (navigateur non connecté).
- Dépense Explee : pas lue (navigateur non connecté). Plafond prévu 29 $/jour, soit ~203 $ au plus.

Règle appliquée : 0 commande mais 3 appels ou plus → **le besoin existe, le parcours bloque**.
Coût réel par commande : pas calculable (0 commande). Coût par prospect qui répond : ~5 $ si le budget a été dépensé en entier.
Niche gagnante : **Vérandalistes & Pergolistes** (56 % des réponses, la seule qui va jusqu'au bout du formulaire).

## Point du 23 nov. 2026 (soir)
- **Commandes payées : toujours 0.** Les seules lignes `orders` depuis le 14 nov. sont des tests (« TEST… », « Linkfinder AI ») ; la commande « abri de jardin » du 17/11 citée dans le verdict est la commande de test du générateur (préau, 72700).
- Explee creha.fr (61157), 7 derniers jours : 4 378 emails, 93 réponses (2,1 %), **14 prospects chauds**, 131 $ dépensés. Depuis le début : 7 944 emails, 37 prospects chauds, 238 $.
  Par campagne (depuis le début) : Vérandalistes & Pergolistes 22 chauds / 149 $ (≈ 6,8 $ le chaud, réserve de leads presque épuisée : 2 770 / 3 361) ; Abris de jardin 5 / 31 $ ; Piscinistes 4 / 18 $ ; Clôturistes 3 / 20 $ ; Abris & constructions bois 3 / 18 $.
- Site (PostHog, urbatik.com) : 5 à 16 visiteurs par jour du 14 au 20 nov., puis 3 à 5 par jour depuis le 21 ; 32 visites venues d'Explee (utm_campaign=creha) sur la période, aucune depuis le 19.
- **Le solde de l'organisation Explee est négatif (≈ -30 $)** : les appels API payants renvoient 402. Les campagnes risquent de s'arrêter d'envoyer jusqu'à la recharge.
- Accueil changé (demande du gérant) : le titre ne parlait que de la déclaration préalable ; il dit maintenant « Déclaration préalable ou permis de construire », avec les deux prix sous le titre (249 € HT / 390 € HT).

## Décision du 25 nov. 2026 : on arrête de payer, on attend le différé jusqu'au 25 déc.
Chiffres lus le 25 nov. (Explee creha.fr 61157, depuis le début) : 9 510 emails, 186 réponses, 39 prospects chauds, **380 $ dépensés, 0 commande réelle** (les 9 lignes `orders` sont des tests).
- **Toutes les campagnes creha.fr en pause** (« Stop campaigns and spending », 25 nov. ~11:20). Plus aucune dépense.
- **Email « carnet de commandes » envoyé à 18 prospects chauds** (ceux qu'on n'avait pas déjà relancés 3 fois, dernier message de notre part il y a plus de 3 jours) : « un chantier DP/PC dans les 3 prochains mois ? Répondez avec la ville et le type de projet, dossier en 72 h dès 249 € HT ». Signé du même prénom que le fil. Envoyé depuis l'inbox Explee.
- **3 prospects ont demandé un appel** : pas d'email, à appeler par le gérant (noms et numéros donnés dans la conversation, pas ici : dépôt public).
- Le site urbatik.com reste en ligne.
- **Règle de décision au 25 déc. 2026** : 0 commande payée → on arrête Urbatik pour de bon. 1 commande ou plus → petite campagne sur Vérandalistes & Pergolistes seulement (56 % des réponses).

## Attention aux chiffres PostHog (25 nov. 2026)
Le navigateur du gérant (Mac, Chrome 138, écran 1440, Stains) était identifié dans PostHog comme un prospect pisciniste depuis le 16 nov. 11:55 : il avait ouvert un lien d'email contenant `e=<email du prospect>`, et le site fait `identify` sur ce paramètre. Résultat : **20 sessions du gérant comptées comme ce prospect** (16 → 25 nov.), dont le clic sur le téléphone du 25 nov. Seule la toute première session (Montesson, Chrome 157, écran 2560) est le vrai prospect.
Corrigé le 25 nov. : `posthog.reset()` + `opt_out_capturing()` dans le Chrome du gérant sur urbatik.com. Les visites « creha » des rapports précédents peuvent donc contenir des visites du gérant. Règle : ne jamais ouvrir un lien de prospect (avec `e=`) depuis son propre navigateur. Les visites depuis 4.251.36.x (Microsoft) sont le scanner de liens d'Outlook, pas des humains.

## Offre Black Friday : premier dossier offert (25 nov. 2026, idée du gérant)
- Offre : jusqu'au **lundi 1er décembre**, le premier dossier (DP ou permis) est préparé gratuitement, un par entreprise. Pour en profiter, le prospect répond avec l'adresse du chantier, le type de travaux et 2-3 photos (pas de commande sur le site : le parcours de paiement n'a pas de code gratuit).
- Envoyée le 25 nov. ~20:05 en réponse dans chaque fil Explee (projet 61157), par `findlinkai/workers/explee-autogtm/urbatik_bf_offer.py --reply` (workflow `explee-urbatik-bf.yml`) : **16 envoyés**, 8 refusés par Explee (4e message), 20 reportés au 26 nov. (déjà écrits le 25 au matin), exclus : pas intéressés / partis (139), demandes d'appel (6), RDV/gagné/perdu (7), « arrêtez de relancer » (1).
- Une campagne importée était impossible : Explee dédoublonne contre le projet (57 sur 58 déjà présents).
- **À faire à chaque réponse** : créer la commande à 0 € et livrer le dossier en 72 h. Les pages vues d'un prospect qui a un vrai chantier sont l'objectif du test du 25 déc.
