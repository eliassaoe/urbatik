"""DP6 Insertion paysagère : le projet ajouté dans la photo du client par une IA d'édition d'image.

Les proportions viennent des données, pas de l'imagination du modèle : on lui donne la hauteur
connue de la maison (gouttière, faîtage) comme repère et les dimensions exactes du projet.

    python3 generateur/photomontage.py entree.json photo_ensemble.jpg insertion.png

Clé : OPENAI_API_KEY dans l'environnement du serveur (jamais dans le dépôt). Le résultat est
toujours relu : le relecteur vérifie proportions, couleurs et emplacement avant envoi en mairie.
"""
import json, os, sys, urllib.request, uuid, base64

MODELE = os.environ.get("IMAGE_MODEL", "gpt-image-1")


def consigne(d):
    p, m = d["projet"], d["maison"]
    imp = p["implantation"]
    ouv = "; ".join(f"{o['type']}" for o in p.get("ouvertures", [])) or "aucune"
    dist = d.get("_distances_limites") or {}
    limite = [k for k, v in dist.items() if v is not None and v < 0.3]
    return (
        "Photomontage réaliste pour un dossier de déclaration préalable en mairie (pièce DP6, insertion paysagère). "
        "Garde la photo strictement identique : même cadrage, même lumière, même maison, mêmes végétaux, mêmes voisins. "
        f"Ajoute uniquement ce projet : {p['libelle'].lower()}, {imp.get('texte', '')}"
        + (", posé en limite de propriété (contre la clôture ou le muret visible)" if limite else "") + ". "
        f"Dimensions exactes : {p['profondeur']} m le long du mur de la maison, {p['largeur']} m d'avancée, {p['hauteur']} m de haut. "
        f"Repère d'échelle : la gouttière de la maison est à {m['hauteur_gouttiere']} m et le faîtage à {m['hauteur_faitage']} m ; "
        f"le projet arrive donc à {round(p['hauteur'] / m['hauteur_gouttiere'] * 100)} % de la hauteur de la gouttière. "
        f"Toiture : {p.get('toiture', '')}. Parois et couleurs : {p.get('parois', '')}. Ouvertures du projet : {ouv}. "
        "Règles impératives : ne recouvre, ne déplace et ne redessine aucune fenêtre, porte ou ouverture existante de la maison ; "
        "si une fenêtre existante se trouve à l'emplacement, le projet s'arrête à côté ou en dessous, jamais par-dessus ; "
        "aucune fenêtre de la maison ne doit apparaître sur le bardage du projet ; "
        "pas de texte, pas de personnes, pas de mobilier ajouté, rien d'autre ne change. Rendu photographique, pas d'illustration."
    )


def inserer(d, photo, sortie, cle=None, modele=MODELE):
    cle = cle or os.environ["OPENAI_API_KEY"]
    b = "----" + uuid.uuid4().hex
    corps = b"".join([
        f"--{b}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{modele}\r\n".encode(),
        f"--{b}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{consigne(d)}\r\n".encode(),
        f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n".encode(),
        open(photo, "rb").read(), f"\r\n--{b}--\r\n".encode()])
    req = urllib.request.Request("https://api.openai.com/v1/images/edits", data=corps,
                                 headers={"Authorization": f"Bearer {cle}", "Content-Type": f"multipart/form-data; boundary={b}"})
    rep = json.loads(urllib.request.urlopen(req, timeout=300).read())
    open(sortie, "wb").write(base64.b64decode(rep["data"][0]["b64_json"]))
    return sortie


if __name__ == "__main__":
    d = json.load(open(sys.argv[1]))
    if "--consigne" in sys.argv: print(consigne(d))
    else: print(inserer(d, sys.argv[2], sys.argv[3]))
