# Générateur de dossiers : les données dont l'IA a besoin

Décision du gérant (17 nov. 2026) : l'IA produit **le dossier complet**, le prestataire ComeUp
fait **seulement la relecture et les corrections**. S'il manque une information pour que l'IA
dessine juste, on la demande au client dans le formulaire de commande. Rien n'est deviné.

Base de travail : les 4 dossiers du prestataire (`img/exemples/`). Ils ont tous la même
structure : page de garde avec la liste des pièces, puis les pièces dans cet ordre, chacune avec le
même cartouche en bas à droite (titre, échelle, code de la pièce).

## Les pièces, et d'où vient chaque donnée

| Pièce | Contenu | Source | Qui |
| --- | --- | --- | --- |
| Page de garde | Liste des pièces, type de dossier, projet, maître d'ouvrage, adresse | Formulaire | Auto |
| DP1 / PCMI1 Plan de situation | Extrait cadastral au 1/2000 (parcelle en rouge, numéro) + vue aérienne IGN | Adresse → API Adresse → cadastre IGN (Parcellaire Express) + orthophoto IGN | Auto |
| DP2 / PCMI2 Plan de masse avant / après, 1/100 à 1/200 | Contour exact de la parcelle, maison, voisins numérotés, voie, projet coté, distances aux limites, hauteurs, flèches des photos DP7/DP8, nord, légende | Cadastre (parcelle + bâtiment, en mètres Lambert-93) + formulaire (projet, implantation) | Auto |
| DP3 / PCMI3 Coupe avant / après | Terrain naturel ±0.00, maison (gouttière, faîtage), projet, limites, cotes | Formulaire (hauteurs maison + projet) | Auto |
| DP4 / PCMI5 Façades avant / après | Les 4 façades (ou celle(s) concernée(s)), cotes de niveau, matériaux et couleurs | Formulaire (hauteurs, matériaux, couleurs, ouvertures) | Auto |
| DP5 Vues 3D | 2 vues en perspective de la maison + projet | Modèle 3D construit à partir des mêmes données | Auto |
| DP6 / PCMI6 Insertion paysagère | Photo du client avec le projet ajouté | Photo « vue d'ensemble » + IA d'édition d'image | IA, à vérifier |
| DP7 / DP8 Vues de près / de loin | Les 2 photos, avec l'angle reporté sur DP1/DP2 | Photos du client + position de prise de vue | Auto |
| DP11 / PCMI4 Notice | État des lieux, projet, surfaces, réseaux | Formulaire + texte IA | IA, à vérifier |
| Cerfa 13703 / 16702 (DP) ou 13406 (PCMI) | Formulaire rempli | Formulaire | Auto |

## Ce que le formulaire doit demander en plus (aujourd'hui en texte libre ou absent)

Aujourd'hui `dimensions` et `distance_limites` sont des champs texte libres : l'IA ne peut pas
dessiner juste à partir de « 6 m × 3 m, accolée à la façade arrière ». Il faut des champs chiffrés.

**Le projet**
- Largeur (m), profondeur (m), hauteur maximale (m) — séparés.
- Forme du toit : plat / 1 pente / 2 pentes ; si pente : hauteur à l'égout et au faîtage.
- Position : accolé à la maison (quelle façade : avant, arrière, gauche, droite — repérée sur
  la photo) ou isolé dans le jardin.
- Distance à chaque limite proche (m), ou « en limite » (0). Distance à la maison si isolé.
- Ouvertures : nombre, largeur × hauteur, sur quelle face.
- Matériaux et couleurs de la structure, de la toiture, des parois (liste + champ libre).

**La maison existante** (pour la coupe et les façades)
- Hauteur à la gouttière et au faîtage (m) — à défaut, nombre de niveaux (on en déduit une
  estimation que le relecteur vérifie).
- Toiture (tuiles, ardoise, bac acier, toit plat) et couleur ; façade (enduit, couleur) ;
  menuiseries (matériau, couleur).

**Le terrain**
- Surface du terrain (m²) — vérifiée contre le cadastre.
- Arbres abattus : oui / non. Terrain modifié : oui / non (déjà demandé).
- Raccordements existants : eau, électricité, assainissement (collectif / individuel).

**Les photos** (déjà demandées) : une de près sur l'emplacement, une de loin depuis la rue.
Ajouter : « d'où avez-vous pris chaque photo ? » (on place la flèche sur le plan).

## Ce que le relecteur garde

- Vérifier le PLU (hauteur, recul, emprise, aspect) — l'IA prépare l'extrait, il valide.
- Contrôler les cotes du plan de masse contre la réalité (cadastre ≠ terrain à quelques cm près).
- Corriger l'insertion paysagère si les proportions sont fausses.
- Extensions et surélévations : relevé des façades existantes — restent chez lui au début.

## Mis en place le 17 nov. 2026 : la fiche technique sur /suivi

Choix : on ne rallonge **pas** le formulaire de commande (avant paiement, chaque question en plus
fait perdre des commandes). Tout ce que le générateur demande en plus arrive **après le paiement**,
sur la page de suivi, et le dossier ne démarre pas tant que ce n'est pas complet.

- **Une seule liste de champs** : `FICHE` dans `supabase/functions/_shared/dossier-express.ts`.
  La page /suivi l'affiche (champs selon le type d'ouvrage et les réponses : « une pente » fait
  apparaître la hauteur à l'égout, « accolé » la façade d'accroche…), le serveur valide avec
  (`validerFiche` : nombres, bornes, égout ≤ faîtage), et `missingItems` la compte comme manquante.
- **Stockage** : `orders.fiche_technique` (jsonb) et `orders.fiche_technique_at`.
- **Photos en plus** (`order_files.kind`) : `facade_avant`, `facade_arriere`, `facade_gauche`,
  `facade_droite` (portes et fenêtres pour dessiner les 4 façades), `photo_emplacement` (de près,
  pour l'insertion paysagère). Une façade déclarée inaccessible (collée au voisin) n'est pas exigée.
- L'email de confirmation de paiement et la page /suivi listent ce qui manque ; un email prévient
  l'admin quand la fiche est complète.
- Modifiable jusqu'à la préparation du dossier, verrouillée ensuite (statut `en_relecture`).

Reste à faire : brancher `generateur/dossier.py` sur `orders.fiche_technique` + cadastre, puis
l'envoi automatique au relecteur.
