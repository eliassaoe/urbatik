# Formulaire de commande court (19 nov. 2026)

Gérant : « Il faut que le paiement soit super simple. On va perdre des gens pour faire des trucs à la con. »

**Avant le paiement, 4 écrans seulement :** type de dossier → ouvrage → adresse → contact (nom, entreprise, email, téléphone) → payer.
Plus rien d'autre avant de payer : pas de PLU, pas de photo, pas de mesure. Ne rien rajouter sans l'accord du gérant.

**Après le paiement**, sur `/suivi` : la fiche technique (section « Le chantier » : propriétaire, surface, hauteur, matériaux,
couleurs, terrain ; puis mesures, distances, maison, terrain) et les photos. `client-order` recopie ces réponses dans les
colonnes de la commande (`orderFromFiche`) pour que le générateur et l'admin les lisent comme avant ; `ficheAvecCommande`
pré-remplit la fiche avec ce que la commande contient déjà.

**Relances :** les réponses du dernier écran sont gardées côté serveur (`dossier_clients.draft`, via `dossier-visit`
action `draft`). Chaque relance d'abandon et le bouton du CRM donnent un lien `?d=` qui rouvre la demande **déjà remplie**,
sur n'importe quel appareil. Règle du gérant : toute relance d'un prospect qui a rempli le formulaire renvoie ce lien.

**Paiement :** sans fichier, le formulaire ne dépend plus du script Supabase pour payer (un CDN en panne ne bloque plus la vente).
Testé le 19 nov. : type › ouvrage › adresse › contact › final, bouton « Payer 174 € HT », redirection vers le paiement.
