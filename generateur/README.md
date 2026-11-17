# Générateur de dossiers (v0, 17 nov. 2026)

`dossier.py` produit un dossier de déclaration préalable complet (13 pages A3, au format du
prestataire ComeUp) à partir de :
- la géométrie du cadastre IGN (parcelle, maison, voisins) — en production, récupérée par le serveur
  (le bac à sable de Claude n'a pas accès à data.geopf.fr ; on l'a interrogé via `pg_net`) ;
- les réponses du client au formulaire (voir `docs/generateur/donnees-necessaires.md`).

    python3 generateur/dossier.py entree.json sortie.pdf --photos dossier_photos/

Les fichiers d'entrée réels (`exemples/*.json`) ne sont **jamais** commités : ils contiennent le
numéro de parcelle et la commune du client, qui l'identifient. Le dépôt est public.

## Chaîne complète (commande payée -> dossier à relire)

    python3 generateur/depuis_commande.py commande.json photos/ entree.json   # cadastre IGN + fiche + photos
    python3 generateur/photomontage.py entree.json photos/photo_ensemble.jpg photos/insertion.png
    python3 generateur/dossier.py entree.json dossier.pdf --photos photos/

- `depuis_commande.py` : géocode l'adresse, prend la parcelle qui contient le point d'adresse et le plus
  grand bâtiment du cadastre comme maison, place le projet d'après la fiche (façade nommée par rapport à
  la rue : avant = côté rue, gauche/droite vus de la rue). Toute valeur déduite va dans `_a_verifier`,
  la liste que lit le relecteur.
- `vision.py` : lit portes et fenêtres sur les photos de façade (API Anthropic, `ANTHROPIC_API_KEY`).
- `photomontage.py` : DP6, le projet inséré dans la photo du client (API OpenAI images, `OPENAI_API_KEY`).
- `dossier.py` : vue aérienne IGN (WMS) en DP1, réseaux indicatifs et flèches DP7/DP8 sur le plan de
  masse, façades avec ouvertures existantes, toit plat / une pente / deux pentes, ouvrage accolé ou isolé.

Tests faits le 17 nov. : préau accolé (DP, Sarthe) refait depuis une commande simulée, même emplacement
que le prestataire ; carport isolé à deux pentes (PC, Pays basque), coupe 0,71 m + 6 m + 4,73 m cohérente
avec le plan. Vision et photomontage écrits mais jamais appelés (pas de réseau ni de clé dans le bac à sable).

Pas encore géré : balcon, surélévation / extension à étage, travaux combinés, plans de piscine, clôture
et panneaux solaires (la fiche est demandée, le dessin reste au relecteur).

## Ce que fait la v0
Page de garde, DP1 extrait cadastral, DP2 plan de masse avant / après coté (1/100, orienté comme le
prestataire), DP3 coupe avec limites de propriété, DP4 les 4 façades avant / après (projet masqué
quand il est derrière la maison), DP5 deux vues 3D, DP7/DP8 photos, DP11 notice.

## En production (17 nov. 2026)
1. Fiche complète + photos reçues sur /suivi -> `lancerGeneration()` (client-order) crée une ligne
   `dossier_generations` et lance `.github/workflows/generer-dossier.yml` avec un jeton à usage unique (3 h).
2. Le workflow exécute `generateur/ci.py` : tout passe par l'Edge Function `dossier-ia` (commande, photos,
   lecture des façades et photomontage via OpenRouter, dépôt du PDF dans le stockage privé).
3. Email à l'admin + carte « Dossier généré par l'IA » sur /admin/dossiers, onglet « Dossiers IA » pour la
   liste ; bouton « Relancer », bouton « Relu, validé ».

Secrets Supabase à saisir par le gérant : `OPENROUTER_API_KEY`, `GITHUB_DISPATCH_TOKEN` (jeton GitHub à
grain fin, dépôt eliassaoe/urbatik seulement, droit Contents: write). Aucune clé dans GitHub.
Dépôt public = journaux d'Actions publics : `ci.py` n'écrit rien de la commande, le PDF n'est jamais un artefact.

## v2 (18 nov. 2026, après comparaison avec le dossier du prestataire)
- Façades : menuiseries dessinées (dormant, ouvrants, vitrage, appui, volets, porte de garage sectionnelle),
  rangs de tuiles, avant au-dessus / après en dessous ; « projet non visible » en étiquette, sans pointillés.
- Implantation : les distances aux limites de la fiche servent de contrôle et corrigent la position si elles
  contredisent la façade cochée ; la remarque part au relecteur.
- Ouvertures du projet lues dans le texte de la fiche (« 1,80 x 2,10 m, ouverture libre »).
- Photomontage : modèle d'image réglable (IMAGE_MODEL, aujourd'hui google/gemini-3-pro-image), puis
  contrôle par le modèle de vision (VISION_MODEL, aujourd'hui anthropic/claude-fable-5.2) qui compare avec la
  photo d'origine ; refait jusqu'à 3 fois si une fenêtre a été ajoutée, cachée ou déplacée.

## Ce qui reste marqué « À compléter par le relecteur » (orange)
- Ce que l'IA n'a pas pu produire : DP6 sans clé d'image, vue aérienne si l'IGN ne répond pas.
