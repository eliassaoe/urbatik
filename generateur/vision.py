"""Lecture des photos de façade par l'IA : portes et fenêtres existantes.

Le modèle reçoit une photo prise de face et renvoie les ouvertures en fractions du mur
(0 = bord gauche, 1 = bord droit ; 0 = sol, 1 = gouttière). Le générateur les remet à l'échelle
avec la largeur réelle du mur (cadastre) et la hauteur à la gouttière (fiche technique).

    python3 generateur/vision.py photo.jpg 10.08 2.90      # -> JSON des ouvertures en mètres

Clé : ANTHROPIC_API_KEY dans l'environnement du serveur (jamais dans le dépôt).
"""
import base64, json, mimetypes, os, sys, urllib.request

MODELE = os.environ.get("VISION_MODEL", "claude-opus-5-5")

CONSIGNE = """Tu regardes la photo d'une façade de maison, prise de face.
Repère le mur de la maison (de l'angle gauche à l'angle droit, du sol à la gouttière) et
chaque ouverture visible dans ce mur : porte, porte-fenêtre, fenêtre, baie, porte de garage.
Réponds uniquement en JSON, sans texte autour :
{"facade_visible": true|false,
 "photo_de_face": true|false,
 "ouvertures": [{"type": "porte|porte_fenetre|fenetre|baie|garage",
                 "x0": 0.00, "x1": 0.00, "bas": 0.00, "haut": 0.00, "volets": true|false}],
 "remarques": "ce qui empêche une lecture fiable, sinon vide"}
x0, x1 : bords gauche et droit de l'ouverture en fraction de la largeur du mur (0 à 1).
bas, haut : en fraction de la hauteur du mur entre le sol et la gouttière (0 à 1 ; > 1 si au-dessus).
N'invente rien : une ouverture cachée par une haie n'est pas listée, et tu le dis dans remarques."""


def lire_facade(chemin, cle=None, modele=MODELE):
    cle = cle or os.environ["ANTHROPIC_API_KEY"]
    media = mimetypes.guess_type(chemin)[0] or "image/jpeg"
    img = base64.b64encode(open(chemin, "rb").read()).decode()
    corps = {"model": modele, "max_tokens": 1500, "messages": [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": media, "data": img}},
        {"type": "text", "text": CONSIGNE}]}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(corps).encode(),
                                 headers={"x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    rep = json.loads(urllib.request.urlopen(req, timeout=120).read())
    texte = "".join(b.get("text", "") for b in rep["content"])
    return json.loads(texte[texte.index("{"): texte.rindex("}") + 1])


def en_metres(lecture, largeur_mur, hauteur_gouttiere):
    """Fractions -> mètres. Ce que le générateur dessine."""
    out = []
    for o in lecture.get("ouvertures", []):
        out.append({"type": o["type"], "x0": round(o["x0"] * largeur_mur, 2), "x1": round(o["x1"] * largeur_mur, 2),
                    "bas": round(o["bas"] * hauteur_gouttiere, 2), "haut": round(o["haut"] * hauteur_gouttiere, 2),
                    "volets": bool(o.get("volets"))})
    return out


if __name__ == "__main__":
    l = lire_facade(sys.argv[1])
    print(json.dumps({"lecture": l, "metres": en_metres(l, float(sys.argv[2]), float(sys.argv[3]))}, ensure_ascii=False, indent=1))
