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
    return (
        "Photomontage réaliste pour un dossier de déclaration préalable en mairie. "
        "Garde la photo strictement identique (cadrage, lumière, maison, jardin, voisins) et ajoute seulement ce projet : "
        f"{p['libelle'].lower()}, {p['implantation'].get('texte', '')}. "
        f"Dimensions exactes : {p['largeur']} m × {p['profondeur']} m au sol, {p['hauteur']} m de haut. "
        f"Repère d'échelle : la gouttière de la maison est à {m['hauteur_gouttiere']} m, le faîtage à {m['hauteur_faitage']} m ; "
        f"le projet doit donc arriver à {round(p['hauteur'] / m['hauteur_gouttiere'] * 100)} % de la hauteur de la gouttière. "
        f"Toiture : {p.get('toiture', '')}. Parois et couleurs : {p.get('parois', '')}. "
        "Pas de texte, pas de personnes, pas de mobilier ajouté, rien d'autre ne change."
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
