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


def lire_ouverture(texte):
    """« 1,80 x 2,10 m, ouverture libre sans porte » -> largeur, hauteur, genre. Rien d'inventé : sans mesures, largeur 0."""
    import re
    t = texte.lower()
    nums = [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", t)]
    nums = [x / 100 if x > 20 else x for x in nums]          # « 180 x 210 » en cm
    larg, haut = (nums[0], nums[1]) if len(nums) >= 2 else (0, 0)
    genre = "garage" if "garage" in t or "sectionnel" in t else "baie" if "baie" in t or "coulissant" in t else \
        "porte_fenetre" if "porte-fen" in t or "porte fen" in t else "fenetre" if "fen" in t else "porte"
    libre = "libre" in t or "sans porte" in t or "passage" in t
    return {"type": texte.strip(), "largeur": larg, "hauteur": haut, "genre": genre, "libre": libre, "face": "exterieure"}


def accroche(d, idx, pos, largeur, profondeur):
    """Projet accolé à l'arête idx de la maison, calé à gauche / centré / à droite (vu de l'extérieur)."""
    maison = d["maison"]["contour"]
    L = D.dist(*D.edges(maison)[idx])
    if pos == "toute": long_, dec = L, 0
    else: long_ = largeur; dec = {"gauche": 0, "centre": (L - largeur) / 2, "droite": L - largeur}[pos]
    a, b = D.edges(maison)[idx]; nv = D.normale_ext(maison, a, b); t = (-nv[1], nv[0])
    depuis = "debut" if a[0] * t[0] + a[1] * t[1] < b[0] * t[0] + b[1] * t[1] else "fin"
    # le générateur : « profondeur » = le long du mur, « largeur » = l'avancée
    return {"arete": idx, "depuis": depuis, "decalage": round(max(0, dec), 2)}, profondeur, long_


def limites(d):
    """Les côtés de la parcelle nommés comme sur la fiche : avant (rue), arriere (fond), gauche, droite."""
    par = d["parcelle"]; c = D.centroid(d["maison"]["contour"])
    r = D.route_arete(d); n_rue = D.unit(D.sub(D.mul(D.add(*r), 0.5), c))
    gauche = (n_rue[1], -n_rue[0])     # vu depuis la rue, face à la maison
    out = {"avant": [], "arriere": [], "gauche": [], "droite": []}
    for a, b in D.edges(par):
        nv = D.normale_ext(par, a, b); dp = nv[0] * n_rue[0] + nv[1] * n_rue[1]
        cote = "avant" if dp > 0.7 else "arriere" if dp < -0.7 else ("gauche" if nv[0] * gauche[0] + nv[1] * gauche[1] > 0 else "droite")
        out[cote].append((a, b))
    return out


def ecarts(d, imp, larg, prof):
    """Distance du projet à chaque limite, et une pénalité s'il déborde de la parcelle ou chevauche la maison."""
    pc = D.projet_contour(d["maison"]["contour"], imp, larg, prof)[0]
    par = d["parcelle"]
    dehors = sum(1 for q in pc if not dans(q, par) and min(D.seg_dist(q, a, b) for a, b in D.edges(par)) > 0.05)
    mi = D.centroid(pc)
    sur_maison = dans(mi, d["maison"]["contour"])
    dist = {k: round(min(D.seg_dist(q, a, b) for q in pc for a, b in e), 2) for k, e in limites(d).items() if e}
    return dist, 100 * dehors + 100 * sur_maison


def placer(d, f, largeur, profondeur):
    """Choisit l'implantation : ce que le client a coché, corrigé par les distances aux limites qu'il a données.
    Renvoie (implantation, largeur, profondeur, remarque pour le relecteur)."""
    noms = D.noms_facades(d)
    voulu = {k: f[f"dist_{k}_m"] for k in ("avant", "arriere", "gauche", "droite") if isinstance(f.get(f"dist_{k}_m"), (int, float))}
    ecart_voulu = lambda dist: sum(abs(dist.get(k, v) - v) for k, v in voulu.items())
    cands = []
    if f.get("implantation") == "accole":
        cote, pos = f.get("facade_accroche"), f.get("position_sur_facade", "gauche")
        for idx, nom in noms.items():
            for p_ in ("gauche", "centre", "droite") + (("toute",) if pos == "toute" else ()):
                imp, lg, pf = accroche(d, idx, p_, largeur, profondeur)
                dist, pen = ecarts(d, imp, lg, pf)
                score = ecart_voulu(dist) + pen + (0 if nom == cote else 1.5) + (0 if p_ == pos else 0.4)
                cands.append((score, nom == cote and p_ == pos, imp, lg, pf, nom, p_, dist))
        best = min(cands, key=lambda c: c[0])
        score, exact, imp, lg, pf, nom, p_, dist = best
        imp["texte"] = f"accolé à la façade {nom.replace('arriere', 'arrière')} de la maison"
        note = "" if exact else (f"Implantation corrigée d'après les distances aux limites données par le client : façade {nom}, "
                                 f"position {p_} (le client avait coché façade {cote}, position {pos}). À vérifier.")
    else:
        gap = f.get("distance_maison_m", 2)
        maison = d["maison"]["contour"]
        for idx, nom in noms.items():
            L = D.dist(*D.edges(maison)[idx])
            for lg, pf in ((profondeur, largeur), (largeur, profondeur)):
                for k in range(0, max(1, int((L + pf) / 0.5)) + 1):
                    dec = -pf + 0.5 * k
                    imp = {"arete": idx, "depuis": "debut", "decalage": round(dec, 2), "isole": gap}
                    dist, pen = ecarts(d, imp, lg, pf)
                    if voulu: score = ecart_voulu(dist) + pen
                    else: score = pen + (0 if nom == "arriere" else 1) + abs(dec) * 0.01
                    cands.append((score, imp, lg, pf, nom, dist))
        score, imp, lg, pf, nom, dist = min(cands, key=lambda c: c[0])
        imp["texte"] = f"isolé dans le jardin, à {gap} m de la maison"
        note = ("Ouvrage isolé placé d'après la distance à la maison et les distances aux limites : à vérifier sur le plan."
                if voulu else "Ouvrage isolé : placé derrière la maison (aucune distance aux limites donnée), à vérifier sur le plan.")
    if voulu and ecart_voulu(dist) > 0.5 * len(voulu):
        note += f" Écart avec les distances déclarées : {', '.join(f'{k} {dist.get(k)} m au lieu de {v} m' for k, v in voulu.items())}."
    d["_distances_limites"] = dist
    return imp, lg, pf, note.strip()


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
    imp, larg_proj, prof_proj, note = placer(d, f, largeur, profondeur)
    if note: a_verifier.append(note)
    d["projet"] = {
        "nature": NATURE.get(commande["type_ouvrage"], commande["type_ouvrage"].upper()),
        "libelle": LIBELLE.get(commande["type_ouvrage"], "Travaux"),
        "largeur": larg_proj, "profondeur": prof_proj, "hauteur": hauteur,
        "toit": {"plat": "plat"}.get(f.get("toit"), f.get("toit", "plat")), "hauteur_egout": f.get("hauteur_egout_m"),
        "toiture": commande.get("materiaux", ""), "parois": commande.get("couleurs", ""),
        "implantation": imp,
        "ouvertures": [lire_ouverture(o) for o in (f.get("ouverture_1"), f.get("ouverture_2")) if o],
        "arbres_abattus": f.get("arbres_abattus") == "oui",
        "reseaux": "électricité, eau potable" + (", tout-à-l'égout" if f.get("assainissement") == "collectif" else ""),
    }
    for o in d["projet"]["ouvertures"]:
        if not o["largeur"]: a_verifier.append(f"Ouverture du projet sans dimensions lisibles (« {o['type']} ») : à dessiner.")
    if d["projet"]["ouvertures"]: a_verifier.append("Ouvertures du projet dessinées au centre de la face extérieure : vérifier leur place.")

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
