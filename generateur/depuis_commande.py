"""Une commande payée -> l'entrée du générateur (dossier.py).

Assemble : la commande (formulaire), la fiche technique (/suivi), le cadastre IGN (parcelle,
maison, voisins, en mètres Lambert-93), et les portes et fenêtres lues sur les photos de façade.

    python3 generateur/depuis_commande.py commande.json photos/ entree.json
    python3 generateur/dossier.py entree.json dossier.pdf --photos photos/

commande.json = la ligne `orders` (avec `fiche_technique`). photos/ = les fichiers de la commande,
nommés par leur sorte (photo_facade.jpg, facade_arriere.jpg…).
Ne devine rien sans le dire : chaque valeur déduite est listée dans `_a_verifier` pour le relecteur.
"""
import json, math, os, sys, urllib.error, urllib.parse, urllib.request

import dossier as D

HAUTEURS = {"rdc": (2.7, 5.5), "combles": (2.9, 6.9), "r1": (5.5, 8.0), "r2": (8.3, 10.8)}  # gouttière, faîtage
NATURE = {"veranda": "VERANDA", "pergola": "PERGOLA", "extension": "EXTENSION", "carport": "CARPORT",
          "abri_jardin": "ABRI DE JARDIN", "piscine": "PISCINE", "cloture": "CLOTURE",
          "solaire_toiture": "PANNEAUX SOLAIRES EN TOITURE", "solaire_sol": "PANNEAUX SOLAIRES AU SOL", "menuiseries": "MENUISERIES"}


LIBELLE = {"veranda": "Construction d'une véranda", "pergola": "Installation d'une pergola", "extension": "Construction d'une extension",
           "carport": "Construction d'un carport", "abri_jardin": "Construction d'un abri de jardin", "piscine": "Construction d'une piscine",
           "cloture": "Édification d'une clôture", "solaire_toiture": "Pose de panneaux solaires en toiture",
           "solaire_sol": "Installation de panneaux solaires au sol", "menuiseries": "Modification des menuiseries"}


def get_json(url, essais=4):
    """Les services publics (IGN, adresse) coupent parfois une connexion : on réessaie."""
    import time
    for i in range(essais):
        try: return json.loads(urllib.request.urlopen(url, timeout=40).read())
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if i == essais - 1: raise
            time.sleep(3 * (i + 1))


def geocoder(adresse):
    q = urllib.parse.quote(adresse)
    f = get_json(f"https://api-adresse.data.gouv.fr/search/?q={q}&limit=1")["features"][0]
    p = f["properties"]
    return p["x"], p["y"], p


def wfs(couche, x, y, r=90):
    url = ("https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
           f"&TYPENAMES={couche}&outputFormat=application/json&SRSNAME=EPSG:2154"
           f"&BBOX={x - r},{y - r},{x + r},{y + r},EPSG:2154")
    return get_json(url)["features"]


def anneau(feat, ox, oy):
    g = feat["geometry"]["coordinates"]
    ring = g[0][0] if feat["geometry"]["type"] == "MultiPolygon" else g[0]
    pts = [(round(c[0] - ox, 2), round(c[1] - oy, 2)) for c in ring]
    return pts[:-1] if pts[0] == pts[-1] else pts


def dans(p, poly):
    x, y = p; r = False
    for (x1, y1), (x2, y2) in D.edges(poly):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: r = not r
    return r


def dist_segment(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]; L2 = ax * ax + ay * ay or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / L2))
    return math.hypot(p[0] - a[0] - t * ax, p[1] - a[1] - t * ay)


def rectangle(poly):
    """Le bâtiment du cadastre ramené à 4 coins (rectangle orienté qui l'englobe au mieux)."""
    best = None
    for a, b in D.edges(poly):
        u = D.unit(D.sub(b, a)); n = (-u[1], u[0])
        xs = [q[0] * u[0] + q[1] * u[1] for q in poly]; ys = [q[0] * n[0] + q[1] * n[1] for q in poly]
        aire = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if best is None or aire < best[0]: best = (aire, u, n, min(xs), max(xs), min(ys), max(ys))
    _, u, n, x0, x1, y0, y1 = best
    P = lambda s, t: (round(u[0] * s + n[0] * t, 2), round(u[1] * s + n[1] * t, 2))
    return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]


def construire(commande, photos_dir, lire_photos=True):
    f = commande.get("fiche_technique") or {}
    a_verifier = []
    adresse = f"{commande['adresse_chantier']} {commande['code_postal']} {commande['ville']}"
    x, y, ban = geocoder(adresse)
    ox, oy = round(x, -2) - 500, round(y, -2) - 500
    pt = (round(x - ox, 2), round(y - oy, 2))

    parcelles = wfs("CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle", x, y)
    batis = wfs("CADASTRALPARCELS.PARCELLAIRE_EXPRESS:batiment", x, y)
    polys = [(p["properties"], anneau(p, ox, oy)) for p in parcelles]
    bats = [anneau(b, ox, oy) for b in batis]
    aire = lambda b: abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in D.edges(b)))
    # La parcelle du client : celle qui contient le point d'adresse et porte un bâtiment ; sinon la plus
    # proche qui en porte un (le point d'adresse tombe souvent sur la limite côté rue).
    batie = [pp for pp in polys if any(dans(D.centroid(b), pp[1]) for b in bats)]
    cand = [pp for pp in batie if dans(pt, pp[1])]
    if not cand:
        cand = sorted(batie, key=lambda pp: min(dist_segment(pt, a, b) for a, b in D.edges(pp[1])))
        if cand: a_verifier.append("Le point d'adresse est hors parcelle : parcelle bâtie la plus proche retenue, à vérifier.")
    if not cand: raise ValueError("Aucun bâtiment du cadastre près de l'adresse : dossier à faire à la main.")
    props, parcelle = cand[0]
    siens = sorted([b for b in bats if dans(D.centroid(b), parcelle)], key=lambda b: -aire(b))
    maison = rectangle(siens[0])
    if len(siens) > 1: a_verifier.append(f"{len(siens)} bâtiments sur la parcelle : le plus grand est pris comme maison.")

    g, fa = f.get("maison_gouttiere_m"), f.get("maison_faitage_m")
    if not (g and fa):
        g0, f0 = HAUTEURS.get(f.get("niveaux", "rdc"), HAUTEURS["rdc"])
        g, fa = g or g0, fa or f0
        a_verifier.append(f"Hauteurs de la maison estimées d'après les niveaux : gouttière {g} m, faîtage {fa} m.")

    d = {
        "type_dossier": commande["type_dossier"], "maitre_ouvrage": commande.get("nom_client_final") or commande["contact_nom"],
        "adresse": commande["adresse_chantier"], "commune": f"{commande['code_postal']} {commande['ville']}",
        "cadastre": {"section": props.get("section", ""), "numero": str(int(props.get("numero", "0") or 0)),
                     "feuille": f"{props.get('com_abs', '000')} {props.get('section', '')} {props.get('feuille', '')}",
                     "surface_terrain_m2": f.get("surface_terrain_m2") or props.get("contenance")},
        "origin": [ox, oy], "point_adresse": list(pt), "voie": ban.get("street", ""),
        "parcelle": parcelle,
        "voisins": {str(int(pp[0].get("numero", "0") or 0)): pp[1] for pp in polys if pp[1] is not parcelle},
        "batiments_voisins": [b for b in bats if b not in siens],
        "maison": {"contour": maison, "hauteur_gouttiere": g, "hauteur_faitage": fa,
                   "toiture": f.get("maison_toiture", ""), "facade": f.get("maison_aspect", ""), "menuiseries": "", "ouvertures": {}},
    }

    # Le projet : la façade d'accroche est nommée par rapport à la rue, comme le client la voit.
    noms = D.noms_facades(d)
    largeur, profondeur = f.get("largeur_m"), f.get("profondeur_m")
    hauteur = float(str(commande.get("hauteur_m", "0")).replace(",", "."))
    imp = {"texte": ""}
    if f.get("implantation") == "accole":
        cote = f.get("facade_accroche"); idx = next(i for i, n in noms.items() if n == cote)
        L = D.dist(*D.edges(maison)[idx]); pos = f.get("position_sur_facade", "gauche")
        if pos == "toute": profondeur_long, dec = L, 0
        else: profondeur_long = largeur; dec = {"gauche": 0, "centre": (L - largeur) / 2, "droite": L - largeur}[pos]
        # « gauche » = vu de l'extérieur, face à la façade (comme sur la photo)
        a, b = D.edges(maison)[idx]; nv = D.normale_ext(maison, a, b); t = (-nv[1], nv[0])
        depuis = "debut" if a[0] * t[0] + a[1] * t[1] < b[0] * t[0] + b[1] * t[1] else "fin"
        imp = {"arete": idx, "depuis": depuis, "decalage": round(max(0, dec), 2),
               "texte": f"accolé à la façade {cote.replace('arriere', 'arrière')} de la maison"}
        larg_proj, prof_proj = profondeur, profondeur_long   # le générateur : profondeur = le long du mur
    else:
        a_verifier.append("Ouvrage isolé : position dans le jardin placée d'après la distance à la maison, à vérifier sur le plan.")
        idx = next(i for i, n in noms.items() if n == "arriere")
        imp = {"arete": idx, "depuis": "debut", "decalage": 0, "isole": f.get("distance_maison_m", 2),
               "texte": f"isolé dans le jardin, à {f.get('distance_maison_m', 2)} m de la maison"}
        larg_proj, prof_proj = profondeur, largeur
    d["projet"] = {
        "nature": NATURE.get(commande["type_ouvrage"], commande["type_ouvrage"].upper()),
        "libelle": LIBELLE.get(commande["type_ouvrage"], "Travaux"),
        "largeur": larg_proj, "profondeur": prof_proj, "hauteur": hauteur,
        "toit": {"plat": "plat"}.get(f.get("toit"), f.get("toit", "plat")), "hauteur_egout": f.get("hauteur_egout_m"),
        "toiture": commande.get("materiaux", ""), "parois": commande.get("couleurs", ""),
        "implantation": imp,
        "ouvertures": [{"face": "", "largeur": 0, "hauteur": 0, "type": o} for o in (f.get("ouverture_1"), f.get("ouverture_2")) if o],
        "arbres_abattus": f.get("arbres_abattus") == "oui",
        "reseaux": "électricité, eau potable" + (", tout-à-l'égout" if f.get("assainissement") == "collectif" else ""),
    }
    if f.get("ouverture_1"): a_verifier.append("Ouvertures du projet décrites en texte : à placer sur la façade si besoin.")

    # Portes et fenêtres : lues sur les photos de façade (une par côté).
    if lire_photos:
        import vision
        for cote in ("avant", "arriere", "gauche", "droite"):
            src = next((os.path.join(photos_dir, x) for x in os.listdir(photos_dir) if x.startswith(f"facade_{cote}")), None)
            if cote == (f.get("facade_accroche") if f.get("implantation") == "accole" else None):
                src = src or next((os.path.join(photos_dir, x) for x in os.listdir(photos_dir) if x.startswith("photo_facade")), None)
            if not src: continue
            idx = next(i for i, n in noms.items() if n == cote)
            lecture = vision.lire_facade(src)
            d["maison"]["ouvertures"][cote] = vision.en_metres(lecture, D.dist(*D.edges(maison)[idx]), g)
            if lecture.get("remarques"): a_verifier.append(f"Façade {cote} : {lecture['remarques']}")
    d["_a_verifier"] = a_verifier
    return d


if __name__ == "__main__":
    cmd = json.load(open(sys.argv[1]))
    out = construire(cmd, sys.argv[2], lire_photos=os.environ.get("ANTHROPIC_API_KEY") is not None)
    json.dump(out, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
    print("À vérifier par le relecteur :", *out["_a_verifier"], sep="\n- ")
