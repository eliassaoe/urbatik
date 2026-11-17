# Générateur de dossiers (v0, 17 nov. 2026)

`dossier.py` produit un dossier de déclaration préalable complet (13 pages A3, au format du
prestataire ComeUp) à partir de :
- la géométrie du cadastre IGN (parcelle, maison, voisins) — en production, récupérée par le serveur
  (le bac à sable de Claude n'a pas accès à data.geopf.fr ; on l'a interrogé via `pg_net`) ;
- les réponses du client au formulaire (voir `docs/generateur/donnees-necessaires.md`).

    python3 generateur/dossier.py entree.json sortie.pdf --photos dossier_photos/

Les fichiers d'entrée réels (`exemples/*.json`) ne sont **jamais** commités : ils contiennent le
numéro de parcelle et la commune du client, qui l'identifient. Le dépôt est public.

## Ce que fait la v0
Page de garde, DP1 extrait cadastral, DP2 plan de masse avant / après coté (1/100, orienté comme le
prestataire), DP3 coupe avec limites de propriété, DP4 les 4 façades avant / après (projet masqué
quand il est derrière la maison), DP5 deux vues 3D, DP7/DP8 photos, DP11 notice.

## Ce qui manque (marqué « À compléter par le relecteur » en orange)
- DP1 vue aérienne IGN, DP6 insertion paysagère (IA d'édition d'image sur la photo du client).
- Portes et fenêtres existantes sur les façades, réseaux, flèches de prise de vue des photos.
