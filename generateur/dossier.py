"""Générateur de dossier de déclaration préalable (v0).

Entrée : un JSON (voir exemples/preau.json) = géométrie du cadastre IGN (mètres, Lambert-93)
+ ce que le client a saisi dans le formulaire de commande.
Sortie : un PDF A3 paysage au format des dossiers du prestataire (page de garde, DP1 à DP11),
prêt pour la relecture.

    python3 generateur/dossier.py generateur/exemples/preau.json sortie.pdf [--photos DIR]

v0 : petits ouvrages accolés ou isolés, toit plat ou une pente, maison à deux pans.
Ce qui n'est pas encore généré est marqué en orange sur la page (aucune pièce n'est inventée).
"""
import json, math, sys, os, io, argparse
import pymupdf

W, H = 1190.55, 841.89                 # A3 paysage, en points
PT_PER_M_100 = 1000 / 100 / 25.4 * 72  # 1 m au 1/100 = 10 mm = 28.35 pt
GREY = (0.45, 0.45, 0.45); DARK = (0.25, 0.25, 0.25); RED = (0.85, 0.1, 0.1)
GREEN = (0.80, 0.92, 0.80); BROWN = (0.66, 0.53, 0.43); ROOF = (0.72, 0.72, 0.72)
ORANGE = (0.85, 0.45, 0.05)
FONT = "helv"; BOLD = "hebo"


# ---------- géométrie ----------
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def mul(a, k): return (a[0] * k, a[1] * k)
def norm(a): return math.hypot(*a)
def unit(a): n = norm(a); return (a[0] / n, a[1] / n)
def dist(a, b): return norm(sub(a, b))
def centroid(poly): return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def seg_dist(p, a, b):
    ab = sub(b, a); t = max(0, min(1, ((p[0]-a[0])*ab[0] + (p[1]-a[1])*ab[1]) / (ab[0]**2 + ab[1]**2)))
    return dist(p, add(a, mul(ab, t)))


def poly_dist_to_edge(poly, a, b): return min(seg_dist(p, a, b) for p in poly)


def edges(poly): return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]


def projet_contour(maison, imp, larg, prof):
    """Rectangle du projet accolé à une arête de la maison."""
    a, b = edges(maison)[imp["arete"]]
    if imp.get("depuis") == "fin": a, b = b, a
    u = unit(sub(b, a))
    c = centroid(maison); n = (-u[1], u[0])
    mid = mul(add(a, b), 0.5)
    if (n[0] * (c[0] - mid[0]) + n[1] * (c[1] - mid[1])) > 0: n = (u[1], -u[0])  # vers l'extérieur
    p0 = add(a, mul(u, imp.get("decalage", 0)))
    if imp.get("isole"): p0 = add(p0, mul(n, imp["isole"]))   # ouvrage isolé : décollé de la maison
    p1 = add(p0, mul(u, prof)); p2 = add(p1, mul(n, larg)); p3 = add(p0, mul(n, larg))
    return [p0, p1, p2, p3], u, n


def normale_ext(poly_, a, b):
    nv = unit((b[1] - a[1], -(b[0] - a[0]))); c = centroid(poly_)
    return mul(nv, -1) if (nv[0] * (c[0] - a[0]) + nv[1] * (c[1] - a[1])) > 0 else nv


def route_arete(d): return min(edges(d["parcelle"]), key=lambda s: seg_dist(d["point_adresse"], *s))


def noms_facades(d):
    """Avant = côté rue ; gauche / droite vues depuis la rue (comme le client les décrit)."""
    mai = d["maison"]["contour"]; c = centroid(mai)
    r = route_arete(d); n_rue = unit(sub(mul(add(*r), 0.5), c))
    f = mul(n_rue, -1); gauche = (-f[1], f[0])
    out = {}
    for i, (a, b) in enumerate(edges(mai)):
        nv = normale_ext(mai, a, b); dp = nv[0] * n_rue[0] + nv[1] * n_rue[1]
        out[i] = "avant" if dp > 0.7 else "arriere" if dp < -0.7 else ("gauche" if nv[0] * gauche[0] + nv[1] * gauche[1] > 0 else "droite")
    return out


def fleche(page, a, b, label, color=(0.75, 0.1, 0.1)):
    page.draw_line(a, b, color=color, width=1.6)
    v = (b.x - a.x, b.y - a.y); L = math.hypot(*v) or 1; u_ = (v[0] / L, v[1] / L)
    p1 = pymupdf.Point(b.x - u_[0] * 9 - u_[1] * 5, b.y - u_[1] * 9 + u_[0] * 5)
    p2 = pymupdf.Point(b.x - u_[0] * 9 + u_[1] * 5, b.y - u_[1] * 9 - u_[0] * 5)
    poly(page, [b, p1, p2], color=color, fill=color, width=0.5)
    page.draw_circle(a, 11, color=color, fill=(1, 1, 1), width=1.2)
    txt(page, (a.x, a.y + 3), label, 6.5, BOLD, color, align="center")


def orientation(v):
    """Nom de l'orientation d'une normale (x = est, y = nord)."""
    ang = (math.degrees(math.atan2(v[0], v[1])) + 360) % 360
    noms = ["NORD", "NORD EST", "EST", "SUD EST", "SUD", "SUD OUEST", "OUEST", "NORD OUEST"]
    return noms[int((ang + 22.5) // 45) % 8]


class Vue:
    """Monde (m) -> page (pt), avec rotation (le plan peut ne pas être orienté nord en haut)."""
    def __init__(self, centre_m, centre_pt, echelle, angle):
        self.c, self.cp, self.k, self.ang = centre_m, centre_pt, PT_PER_M_100 * 100 / echelle, angle
        self.ca, self.sa = math.cos(angle), math.sin(angle)

    def __call__(self, p):
        x, y = p[0] - self.c[0], p[1] - self.c[1]
        xr, yr = x * self.ca - y * self.sa, x * self.sa + y * self.ca
        return pymupdf.Point(self.cp[0] + xr * self.k, self.cp[1] - yr * self.k)


# ---------- dessin ----------
def txt(page, p, s, size=9, font=FONT, color=(0, 0, 0), rot=0, align="left"):
    w = pymupdf.get_text_length(s, fontname=font, fontsize=size)
    x = p[0] - (w / 2 if align == "center" else w if align == "right" else 0)
    if rot:
        page.insert_text(pymupdf.Point(p[0], p[1]), s, fontsize=size, fontname=font, color=color,
                         morph=(pymupdf.Point(p[0], p[1]), pymupdf.Matrix(rot)))
    else:
        page.insert_text(pymupdf.Point(x, p[1]), s, fontsize=size, fontname=font, color=color)


def poly(page, pts, color=(0, 0, 0), fill=None, width=0.8, dashes=None, close=True):
    sh = page.new_shape()
    sh.draw_polyline(pts + ([pts[0]] if close else []))
    sh.finish(color=color, fill=fill, width=width, dashes=dashes, closePath=close)
    sh.commit()


def cote(page, a, b, label, off=14, size=7.5):
    """Ligne de cote parallèle à a-b, décalée de off points, avec le texte au milieu."""
    v = (b.x - a.x, b.y - a.y); L = math.hypot(*v) or 1
    n = (-v[1] / L * off, v[0] / L * off)
    a2, b2 = pymupdf.Point(a.x + n[0], a.y + n[1]), pymupdf.Point(b.x + n[0], b.y + n[1])
    sh = page.new_shape()
    sh.draw_line(a, a2); sh.draw_line(b, b2); sh.draw_line(a2, b2)
    for p in (a2, b2):
        t = 3
        sh.draw_line(pymupdf.Point(p.x - t * (v[0] + v[1]) / L, p.y - t * (v[1] - v[0]) / L),
                     pymupdf.Point(p.x + t * (v[0] + v[1]) / L, p.y + t * (v[1] - v[0]) / L))
    sh.finish(color=(0, 0, 0), width=0.5); sh.commit()
    ang = math.degrees(math.atan2(-v[1], v[0]))
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    m = pymupdf.Point((a2.x + b2.x) / 2, (a2.y + b2.y) / 2)
    w = pymupdf.get_text_length(label, fontname=FONT, fontsize=size)
    r = math.radians(ang)
    start = pymupdf.Point(m.x - w / 2 * math.cos(r), m.y + w / 2 * math.sin(r))
    start = pymupdf.Point(start.x - 2.5 * math.sin(r), start.y - 2.5 * math.cos(r))
    page.insert_text(start, label, fontsize=size, fontname=FONT, morph=(start, pymupdf.Matrix(ang)))


def m(x): return f"{x:.2f} m".replace(".", ",")


def niv(x): return ("+" if x > 0 else "±" if x == 0 else "") + f"{x:.2f}m"


def cartouche(page, titre, echelle, code):
    x0, y0 = 850, 762
    page.draw_rect(pymupdf.Rect(x0, y0, 1170, 826), color=(0, 0, 0), width=0.7)
    page.draw_rect(pymupdf.Rect(1090, y0, 1170, 826), color=None, fill=(0.4, 0.4, 0.4))
    page.draw_line(pymupdf.Point(x0 + 70, y0), pymupdf.Point(x0 + 70, 826), width=0.5)
    page.draw_line(pymupdf.Point(x0 + 70, 794), pymupdf.Point(1090, 794), width=0.5)
    txt(page, (1005, 783), titre, 10.5, BOLD, align="center")
    txt(page, (1005, 814), f"Ech : 1/{echelle} ème", 8.5, align="center")
    txt(page, (1130, 800), code, 15, color=(1, 1, 1), align="center")
    txt(page, (x0 + 35, 798), "Urbatik", 9, BOLD, align="center")


def a_faire(page, p, s):
    """Signale ce que le générateur ne produit pas encore : rien n'est inventé."""
    page.draw_rect(pymupdf.Rect(p[0], p[1], p[0] + 420, p[1] + 46), color=ORANGE, width=1.2, dashes="[4] 0")
    txt(page, (p[0] + 10, p[1] + 18), "À COMPLÉTER PAR LE RELECTEUR", 9, BOLD, ORANGE)
    txt(page, (p[0] + 10, p[1] + 34), s, 8.5, color=ORANGE)


def echelle_graphique(page, x, y, k):
    sh = page.new_shape()
    for a, b, f in [(0, 1, True), (1, 5, False), (5, 10, True)]:
        sh.draw_rect(pymupdf.Rect(x + a * k, y, x + b * k, y + 4)); sh.finish(color=(0, 0, 0), fill=(0, 0, 0) if f else None, width=0.5)
    sh.commit()
    for v in (0, 1, 5, 10): txt(page, (x + v * k, y + 13), str(v), 7, align="center")


def fleche_nord(page, c, angle):
    """Flèche du nord, tournée comme le plan."""
    r = 18
    d = (math.sin(angle), math.cos(angle))  # direction du nord sur la page (y vers le haut)
    tip = pymupdf.Point(c[0] + d[0] * r, c[1] - d[1] * r)
    base = pymupdf.Point(c[0] - d[0] * r, c[1] + d[1] * r)
    left = pymupdf.Point(c[0] - d[1] * 6, c[1] - d[0] * 6)
    poly(page, [tip, left, base], fill=(0, 0, 0), width=0.6)
    page.draw_circle(pymupdf.Point(*c), r + 4, color=(0, 0, 0), width=0.6)
    txt(page, (tip.x + d[0] * 10, tip.y - d[1] * 10 + 4), "N", 11, BOLD, align="center")


def nom_ouverture(o):
    if o.get("libre"): return "Ouverture libre sans menuiserie"
    return {"garage": "Porte de garage", "baie": "Baie vitrée", "porte_fenetre": "Porte-fenêtre", "fenetre": "Fenêtre"}.get(o.get("genre"), "Porte")


def note_projet(page, d, x, y, w=300):
    p = d["projet"]; surf = p["largeur"] * p["profondeur"]
    lignes = [f"{p['libelle'].upper()} - {surf:.0f} m²",
              f"· DIMENSIONS : {m(p['largeur'])} (LARGEUR) × {m(p['profondeur'])} (PROFONDEUR).",
              f"· HAUTEUR : {m(p['hauteur'])}.",
              f"· IMPLANTATION : {p['implantation']['texte'].upper()}.",
              f"· {p['toiture'].upper()}.",
              f"· PAROIS : {p['parois'].upper()}."]
    for o in p.get("ouvertures", []):
        lignes.append(f"· {nom_ouverture(o).upper()} : {m(o['largeur'])} × {m(o['hauteur'])}" if o.get("largeur") else f"· OUVERTURE : {o['type'].upper()}")
    rect = pymupdf.Rect(x, y, x + w, y + 14 + 11.5 * sum(1 + len(l) // 62 for l in lignes))
    page.draw_rect(rect, color=(0, 0, 0), fill=(1, 1, 1), width=0.6)
    page.insert_textbox(rect + (6, 5, -6, -4), "\n".join(lignes), fontsize=7.2, fontname=FONT)


# ---------- pièces ----------
PIECES_DP = [("DP1", "Plan de situation"), ("DP2", "Plan de masse"), ("DP3", "Plan de coupe profil du terrain"),
             ("DP4", "Plan des façades et des toitures"), ("DP5", "Vues 3D"), ("DP6", "Insertion du projet"),
             ("DP7", "Terrain vue de près"), ("DP8", "Terrain vue de loin"), ("DP11", "Note architecturale")]


def page_garde(doc, d):
    pg = doc.new_page(width=W, height=H)
    y = 120
    for code, nom in PIECES_DP:
        txt(pg, (90, y), f"{code}", 13, BOLD); txt(pg, (150, y), f": {nom}", 13); y += 30
    txt(pg, (W * 0.62, 150), "DECLARATION PREALABLE", 26, BOLD, align="center")
    x0, x1 = 520, 1110
    rows = [("PROJET", d["projet"]["nature"]), ("MAITRE D'OUVRAGE", d["maitre_ouvrage"]),
            ("ADRESSE DU PROJET", f"{d['adresse']} {d['commune']}".upper())]
    y = 230
    for k, v in rows:
        pg.draw_rect(pymupdf.Rect(x0, y, x1, y + 70), color=(0, 0, 0), width=0.8)
        pg.draw_rect(pymupdf.Rect(x0, y, x0 + 190, y + 70), color=None, fill=(0.4, 0.4, 0.4))
        txt(pg, (x0 + 95, y + 40), k, 12, BOLD, (1, 1, 1), align="center")
        pg.insert_textbox(pymupdf.Rect(x0 + 205, y + 18, x1 - 10, y + 68), v, fontsize=13, fontname=BOLD)
        y += 90
    txt(pg, (x1, 790), "Urbatik", 16, BOLD, align="right")


def dp1(doc, d):
    pg = doc.new_page(width=W, height=H)
    c = centroid(d["parcelle"])
    v = Vue(c, (330, 400), 1000, 0)  # extrait cadastral (1/1000 pour la lisibilité en v0)
    clip = pymupdf.Rect(40, 60, 620, 740)
    pg.draw_rect(clip, color=(0, 0, 0), width=0.6)
    for num, pts in d["voisins"].items():
        poly(pg, [v(p) for p in pts], color=GREY, width=0.5)
        cc = v(centroid(pts))
        if clip.contains(cc): txt(pg, (cc.x, cc.y), num, 8, color=GREY, align="center")
    for b in d.get("batiments_voisins", []): poly(pg, [v(p) for p in b], color=GREY, fill=(0.85, 0.85, 0.85), width=0.4)
    poly(pg, [v(p) for p in d["maison"]["contour"]], fill=(0.85, 0.85, 0.85), width=0.5)
    poly(pg, [v(p) for p in d["parcelle"]], color=RED, width=2)
    cc = v(c); txt(pg, (cc.x, cc.y + 4), d["cadastre"]["numero"], 14, BOLD, RED, align="center")
    txt(pg, (60, 85), "a  EXTRAIT CADASTRAL", 11, BOLD)
    txt(pg, (60, 100), f"Section {d['cadastre']['section']} · parcelle {d['cadastre']['numero']} · {d['commune']}", 8.5)
    fleche_nord(pg, (585, 110), 0)
    img = ortho(d, c, 75)
    zone = pymupdf.Rect(660, 110, 1150, 600)
    if img:
        pg.insert_image(zone, stream=img)
        va = Vue(c, ((zone.x0 + zone.x1) / 2, (zone.y0 + zone.y1) / 2), 150 * 100 / (zone.width / PT_PER_M_100), 0)
        poly(pg, [va(p) for p in d["parcelle"]], color=RED, width=2)
        fleche_nord(pg, (zone.x1 - 30, zone.y0 + 30), 0)
    else:
        a_faire(pg, (680, 300), "Vue aérienne IGN : non récupérée (pas d'accès réseau ici).")
    txt(pg, (680, 280), "b  VUE AERIENNE", 11, BOLD)
    cartouche(pg, "PLAN DE SITUATION", "1000", "DP 1")


def ortho(d, c, demi):
    """Orthophoto IGN (Géoplateforme, WMS public) autour du point c, demi-côté en mètres."""
    import urllib.request
    ox, oy = d["origin"]
    bbox = f"{ox + c[0] - demi},{oy + c[1] - demi},{ox + c[0] + demi},{oy + c[1] + demi}"
    url = ("https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS"
           f"&STYLES=&CRS=EPSG:2154&BBOX={bbox}&WIDTH=1000&HEIGHT=1000&FORMAT=image/jpeg")
    try:
        r = urllib.request.urlopen(url, timeout=20).read()
        return r if r[:2] == b"\xff\xd8" else None
    except Exception:
        return None


def plan_masse(doc, d, apres):
    pg = doc.new_page(width=W, height=H)
    mai = d["maison"]["contour"]; p = d["projet"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    # rotation : le long côté de la maison à la verticale, comme le prestataire
    e = max(edges(mai), key=lambda s: dist(*s))
    ang = math.pi / 2 - math.atan2(e[1][1] - e[0][1], e[1][0] - e[0][0])
    par = d["parcelle"]; c = centroid(par)
    rm0 = mul(add(*route_arete(d)), 0.5)                 # la rue toujours à droite du plan
    if Vue(c, (0, 0), 100, ang)(rm0).x < 0: ang += math.pi
    v = Vue(c, (440, 400), 100, ang)       # centrer sur l'emprise de la parcelle, pas sur la moyenne des sommets
    xs, ys = [v(q).x for q in par], [v(q).y for q in par]
    v = Vue(c, (440 - ((min(xs) + max(xs)) / 2 - 440), 400 - ((min(ys) + max(ys)) / 2 - 400)), 100, ang)
    span = max((max(xs) - min(xs)) / 820, (max(ys) - min(ys)) / 640)
    ech = 100 if span <= 1 else 200 if span <= 2 else 500
    if ech != 100:
        v = Vue(c, (440 - ((min(xs) + max(xs)) / 2 - 440) * 100 / ech, 400 - ((min(ys) + max(ys)) / 2 - 400) * 100 / ech), ech, ang)
        v.cp = (440 + (v.cp[0] - 440), v.cp[1])
    clip = pymupdf.Rect(30, 40, 850, 750)
    # voisins (seulement l'arête commune visible) et leurs numéros
    for num, pts in d["voisins"].items():
        cc = v(centroid(pts))
        poly(pg, [v(q) for q in pts], color=(0.6, 0.6, 0.6), width=0.4)
        lab = v(add(c, mul(unit(sub(centroid(pts), c)), max(dist(c, q) for q in par) + 5)))
        if clip.contains(lab): txt(pg, (lab.x, lab.y), num, 15, BOLD, align="center")
    pg.draw_rect(pymupdf.Rect(0, 0, W, H) - (0, 0, 0, 0), color=None)
    # parcelle : jardin en vert, limite en rouge
    poly(pg, [v(q) for q in par], color=RED, fill=GREEN, width=2.2)
    for a, b in edges(par):
        if dist(a, b) > 4: cote(pg, v(a), v(b), m(dist(a, b)), off=-16)
    # maison : toit gris, faîtage dans l'axe long
    pm = [v(q) for q in mai]
    poly(pg, pm, fill=ROOF, width=1)
    ee = edges(mai); lo = max(range(4), key=lambda i: dist(*ee[i]))
    m1 = v(mul(add(*ee[(lo + 1) % 4]), 0.5)); m2 = v(mul(add(*ee[(lo + 3) % 4]), 0.5))
    pg.draw_line(m1, m2, color=(0, 0, 0), width=0.7, dashes="[5 2] 0")
    mc = v(centroid(mai))
    txt(pg, (mc.x, mc.y - 6), f"Faîtière {niv(d['maison']['hauteur_faitage'])}", 7.5, align="center")
    txt(pg, (mc.x, mc.y + 8), f"Gouttière {niv(d['maison']['hauteur_gouttiere'])}", 7.5, align="center")
    for a, b in ee: cote(pg, v(a), v(b), m(dist(a, b)), off=12)
    # projet
    pp = [v(q) for q in pc]
    if apres:
        poly(pg, pp, fill=DARK, width=1.2)
        cp = v(centroid(pc))
        txt(pg, (cp.x, cp.y - 3), "TOIT PLAT" if p["toit"] == "plat" else "TOITURE", 6.5, BOLD, (1, 1, 1), align="center")
        txt(pg, (cp.x, cp.y + 7), niv(p["hauteur"]), 6.5, BOLD, (1, 1, 1), align="center")
        cote(pg, pp[0], pp[1], m(p["profondeur"]), off=-12); cote(pg, pp[1], pp[2], m(p["largeur"]), off=-12)
        note_projet(pg, d, 870, 600, 290)
    else:
        poly(pg, pp, color=RED, width=1, dashes="[4 3] 0")
        cp = v(centroid(pc)); txt(pg, (cp.x, cp.y), "EMPLACEMENT PROJET", 6.5, BOLD, RED, align="center")
    # distances aux limites : du projet (jusqu'à 6 m, « EN LIMITE » si collé) et de la maison (jusqu'à 15 m)
    def pied(q, a, b):
        ab = sub(b, a); t = ((q[0]-a[0])*ab[0] + (q[1]-a[1])*ab[1]) / (ab[0]**2 + ab[1]**2)
        return add(a, mul(ab, max(0, min(1, t))))
    for a, b in edges(par):
        if dist(a, b) < 2: continue
        dd = poly_dist_to_edge(pc, a, b)
        q = min(pc, key=lambda q: seg_dist(q, a, b))
        if 0.3 < dd < 6:
            cote(pg, v(q), v(pied(q, a, b)), m(dd), off=0)
        elif dd <= 0.3 and apres:
            qq = v(mul(add(*sorted(pc, key=lambda q: seg_dist(q, a, b))[:2]), 0.5))
            txt(pg, (qq.x, qq.y - 4), "EN LIMITE", 6.5, BOLD, RED, align="center")
        dm = poly_dist_to_edge(mai, a, b)
        if 0.3 < dm < 15 and abs(dm - dd) > 0.5:
            qm = min(mai, key=lambda q: seg_dist(q, a, b))
            cote(pg, v(qm), v(pied(qm, a, b)), m(dm), off=0)
    # voie
    route = min(edges(par), key=lambda s: seg_dist(d["point_adresse"], *s))
    rm = v(add(mul(add(*route), 0.5), mul(unit(sub(mul(add(*route), 0.5), c)), 2.2)))
    ra = math.degrees(math.atan2(-(v(route[1]).y - v(route[0]).y), v(route[1]).x - v(route[0]).x))
    if ra > 90: ra -= 180
    if ra < -90: ra += 180
    w = pymupdf.get_text_length(d["voie"].upper(), fontname=BOLD, fontsize=10)
    st = pymupdf.Point(rm.x - w / 2 * math.cos(math.radians(ra)), rm.y + w / 2 * math.sin(math.radians(ra)))
    pg.insert_text(st, d["voie"].upper(), fontsize=10, fontname=BOLD, morph=(st, pymupdf.Matrix(ra)))
    # légende, nord, échelle
    lx, ly = 880, 60
    pg.draw_rect(pymupdf.Rect(lx, ly, 1160, ly + 128), color=(0, 0, 0), width=0.5)
    txt(pg, (lx + 8, ly + 14), "Légende :", 8, BOLD)
    for i, (col, lab) in enumerate([(GREEN, "Espace vert"), (ROOF, "Bâti existant"), (DARK, "Projet")]):
        pg.draw_rect(pymupdf.Rect(lx + 10, ly + 22 + i * 15, lx + 40, ly + 31 + i * 15), color=None, fill=col)
        txt(pg, (lx + 48, ly + 30 + i * 15), f": {lab}", 8)
    fleche_nord(pg, (80, 90), ang)
    echelle_graphique(pg, 80, 735, PT_PER_M_100 * 100 / ech)
    lx, ly = 880, 60
    # réseaux existants : tracé indicatif de la façade côté rue jusqu'à la voie
    route = route_arete(d); noms = noms_facades(d)
    av = [e for i, e in enumerate(edges(mai)) if noms[i] == "avant"] or [min(edges(mai), key=lambda e: seg_dist(mul(add(*e), 0.5), *route))]
    ma = mul(add(*av[0]), 0.5); ua = unit(sub(av[0][1], av[0][0]))
    reseaux = [("EU", BROWN, None), ("EP", (0.2, 0.4, 0.85), "[5 3] 0"), ("AEP", (0.2, 0.4, 0.85), None), ("ELEC", RED, "[5 3] 0")]
    for i_, (lab, col, dash) in enumerate(reseaux):
        o_ = add(ma, mul(ua, (i_ - 1.5) * 0.8))
        rb = sub(route[1], route[0]); t_ = ((o_[0]-route[0][0])*rb[0] + (o_[1]-route[0][1])*rb[1]) / (rb[0]**2 + rb[1]**2)
        pied = add(route[0], mul(rb, max(0, min(1, t_))))
        pg.draw_line(v(o_), v(pied), color=col, width=1, dashes=dash)
        mid = v(mul(add(o_, pied), 0.5)); txt(pg, (mid.x + 3, mid.y), lab, 6, color=col)
    # flèches de prise de vue des photos
    rm_ = mul(add(*route), 0.5); dir_rue = unit(sub(rm_, centroid(mai)))
    fleche(pg, v(add(rm_, mul(dir_rue, 2.5))), v(add(rm_, mul(dir_rue, -3))), "DP8")
    cp_ = centroid(pc)
    fleche(pg, v(add(cp_, mul(n, 5.5))), v(add(cp_, mul(n, 2.6))), "DP7")
    for i_, (lab, col, dash) in enumerate(reseaux):
        yy = ly + 80 + i_ * 13
        pg.draw_line(pymupdf.Point(lx + 10, yy - 3), pymupdf.Point(lx + 40, yy - 3), color=col, width=1, dashes=dash)
        txt(pg, (lx + 48, yy), f": {dict(EU='Eaux usées', EP='Eaux pluviales', AEP='Eau potable', ELEC='Électricité')[lab]} (tracé indicatif)", 7.5)
    cartouche(pg, "PLAN DE MASSE " + ("APRES" if apres else "AVANT"), str(ech), "DP 2")


def profil_projet(p, x0, x1, sol, k, haut_cote_gauche=False):
    """Contour du projet vu de côté : toit plat, une pente (haut côté maison) ou deux pentes."""
    h = p["hauteur"]; e = p.get("hauteur_egout") or h
    if p.get("toit") == "une_pente":
        hg, hd = (h, e) if haut_cote_gauche else (e, h)
        return [(x0, sol), (x0, sol - hg * k), (x1, sol - hd * k), (x1, sol)]
    if p.get("toit") == "deux_pentes":
        return [(x0, sol), (x0, sol - e * k), ((x0 + x1) / 2, sol - h * k), (x1, sol - e * k), (x1, sol)]
    return [(x0, sol), (x0, sol - h * k), (x1, sol - h * k), (x1, sol)]


def coupe(doc, d):
    """Coupe perpendiculaire à l'arête d'accroche : limite - projet - maison - limite."""
    pg = doc.new_page(width=W, height=H)
    mai = d["maison"]["contour"]; p = d["projet"]; mm = d["maison"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    a, b = edges(mai)[p["implantation"]["arete"]]
    larg_maison = max(poly_dist_to_edge([q], a, b) for q in mai)
    k = PT_PER_M_100
    for i, apres in enumerate((False, True)):
        x0, y0 = 120 + i * 0, 330 + i * 330  # avant en haut, après en bas
        sol = y0
        pg.draw_line(pymupdf.Point(60, sol), pymupdf.Point(820, sol), width=1)
        # maison (pignon vu en coupe : deux pans)
        mx = 330
        g, f = mm["hauteur_gouttiere"], mm["hauteur_faitage"]
        pts = [(mx, sol), (mx, sol - g * k), (mx + larg_maison * k / 2, sol - f * k), (mx + larg_maison * k, sol - g * k), (mx + larg_maison * k, sol)]
        poly(pg, [pymupdf.Point(*q) for q in pts], fill=(0.93, 0.93, 0.9), width=1)
        txt(pg, (mx + larg_maison * k + 8, sol - f * k + 4), niv(f), 8); txt(pg, (mx + larg_maison * k + 8, sol - g * k + 4), niv(g), 8)
        txt(pg, (mx + larg_maison * k / 2, sol - g * k / 2), "MAISON EXISTANTE", 7.5, align="center")
        # projet contre la maison, ou à sa distance s'il est isolé
        gap = float(p["implantation"].get("isole") or 0)
        px1 = mx - gap * k; px = px1 - p["largeur"] * k
        if apres:
            poly(pg, [pymupdf.Point(*q) for q in profil_projet(p, px, px1, sol, k)], fill=(0.55, 0.55, 0.55), width=1)
            txt(pg, (px - 52, sol - p["hauteur"] * k + 4), niv(p["hauteur"]), 8)
            cote(pg, pymupdf.Point(px, sol), pymupdf.Point(px1, sol), m(p["largeur"]), off=-22)
            if gap: cote(pg, pymupdf.Point(px1, sol), pymupdf.Point(mx, sol), m(gap), off=-22)
            note_projet(pg, d, 870, 600, 290)
        else:
            pg.draw_rect(pymupdf.Rect(px, sol - p["hauteur"] * k, px1, sol), color=RED, width=1, dashes="[4 3] 0")
            txt(pg, ((px + px1) / 2, sol - p["hauteur"] * k - 6), "EMPLACEMENT PROJET", 7, BOLD, RED, align="center")
        txt(pg, (70, sol + 12), "TN ±0.00", 8)
        # limites de propriété de part et d'autre, à leur vraie distance
        par = d["parcelle"]
        dir_out = n                                    # du mur de la maison vers l'extérieur, côté projet
        def jusqu_a_limite(o, dv):
            best = None
            for e1, e2 in edges(par):
                ex, ey = e2[0] - e1[0], e2[1] - e1[1]; den = dv[0] * ey - dv[1] * ex
                if abs(den) < 1e-9: continue
                tt = ((e1[0] - o[0]) * ey - (e1[1] - o[1]) * ex) / den
                ss = ((e1[0] - o[0]) * dv[1] - (e1[1] - o[1]) * dv[0]) / den
                if tt > 0 and 0 <= ss <= 1: best = tt if best is None else min(best, tt)
            return best or 0
        mid_a = add(mul(add(pc[0], pc[1]), 0.5), mul(dir_out, -gap))   # sur le mur de la maison
        g_lim = jusqu_a_limite(mid_a, dir_out); d_lim = jusqu_a_limite(add(mid_a, mul(dir_out, -larg_maison)), mul(dir_out, -1))
        for xl, lab in ((mx - g_lim * k, "Limite de propriété"), (mx + larg_maison * k + d_lim * k, "Limite de propriété")):
            pg.draw_line(pymupdf.Point(xl, sol + 10), pymupdf.Point(xl, sol - 130), color=(0, 0, 0), width=0.8, dashes="[6 2 1 2] 0")
            txt(pg, (xl + 3, sol - 120), lab, 7, rot=0)
        if g_lim > p["largeur"] + gap + 0.05:
            cote(pg, pymupdf.Point(mx - g_lim * k, sol), pymupdf.Point(px, sol), m(g_lim - p["largeur"] - gap), off=-22)
        cote(pg, pymupdf.Point(mx + larg_maison * k, sol), pymupdf.Point(mx + larg_maison * k + d_lim * k, sol), m(d_lim), off=-22)
        txt(pg, (60, y0 - 250), ("b  COUPE : APRES PROJET" if apres else "a  COUPE : AVANT PROJET"), 10, BOLD)
    txt(pg, (870, 585), f"Toiture maison : {mm['toiture']} · façade : {mm['facade']}", 7.5)
    echelle_graphique(pg, 80, 735, k)
    cartouche(pg, "COUPE", "100", "DP 3")


def menuiserie(pg, rr, genre, volets, k):
    """Une porte ou une fenêtre dessinée comme sur un plan d'architecte : dormant, ouvrants, vitrage, appui."""
    noir, blanc, vitre = (0.15, 0.15, 0.15), (1, 1, 1), (0.8, 0.88, 0.95)
    e = max(1.2, 0.06 * k)                                   # épaisseur du dormant (~6 cm)
    if genre == "garage":
        pg.draw_rect(rr, color=noir, fill=blanc, width=0.9)
        y = rr.y0 + 0.5 * k
        while y < rr.y1 - 2:
            pg.draw_line(pymupdf.Point(rr.x0, y), pymupdf.Point(rr.x1, y), color=noir, width=0.4); y += 0.5 * k
        n = max(2, round(rr.width / (0.6 * k)))
        for i in range(1, n): pg.draw_line(pymupdf.Point(rr.x0 + i * rr.width / n, rr.y0), pymupdf.Point(rr.x0 + i * rr.width / n, rr.y1), color=noir, width=0.25)
        return
    pg.draw_rect(rr, color=noir, fill=blanc, width=0.9)
    inner = pymupdf.Rect(rr.x0 + e, rr.y0 + e, rr.x1 - e, rr.y1 - (0 if genre in ("porte", "porte_fenetre", "baie") else e))
    if genre == "porte":
        pg.draw_rect(inner, color=noir, fill=(0.96, 0.95, 0.92), width=0.5)
        hv = inner.height * 0.28                              # imposte vitrée en haut
        pg.draw_rect(pymupdf.Rect(inner.x0 + e, inner.y0 + e, inner.x1 - e, inner.y0 + hv), color=noir, fill=vitre, width=0.4)
        pg.draw_rect(pymupdf.Rect(inner.x0 + e, inner.y0 + hv + e, inner.x1 - e, inner.y1 - e), color=noir, width=0.3)
        pg.draw_circle(pymupdf.Point(inner.x1 - 2.2 * e, (inner.y0 + inner.y1) / 2), max(0.8, e * 0.5), color=noir, fill=noir)
    else:
        n = 1 if inner.width < 0.65 * k else 3 if genre == "baie" and inner.width > 2.4 * k else 2
        w = inner.width / n
        for i in range(n):
            leaf = pymupdf.Rect(inner.x0 + i * w, inner.y0, inner.x0 + (i + 1) * w, inner.y1)
            pg.draw_rect(leaf, color=noir, width=0.5)
            glass = pymupdf.Rect(leaf.x0 + e * 0.8, leaf.y0 + e * 0.8, leaf.x1 - e * 0.8, leaf.y1 - e * (3 if genre == "porte_fenetre" else 0.8))
            pg.draw_rect(glass, color=noir, fill=vitre, width=0.35)
            if genre == "porte_fenetre":                     # soubassement plein
                pg.draw_rect(pymupdf.Rect(glass.x0, glass.y1, glass.x1, leaf.y1 - e * 0.8), color=noir, fill=blanc, width=0.35)
        if genre in ("fenetre",):                            # appui de fenêtre
            pg.draw_rect(pymupdf.Rect(rr.x0 - 2, rr.y1, rr.x1 + 2, rr.y1 + max(1.5, 0.05 * k)), color=noir, fill=(0.85, 0.85, 0.85), width=0.5)
    if volets:
        for x_ in (rr.x0 - rr.width / 2, rr.x1):
            v = pymupdf.Rect(x_, rr.y0, x_ + rr.width / 2, rr.y1)
            pg.draw_rect(v, color=noir, fill=(0.93, 0.93, 0.9), width=0.5)
            y = v.y0 + 3
            while y < v.y1: pg.draw_line(pymupdf.Point(v.x0, y), pymupdf.Point(v.x1, y), color=(0.5, 0.5, 0.5), width=0.2); y += 3


def etiquette_non_visible(pg, cx, cy):
    r = pymupdf.Rect(cx - 70, cy - 13, cx + 70, cy + 13)
    pg.draw_rect(r, color=(0.2, 0.2, 0.2), fill=(1, 1, 1), width=0.8)
    txt(pg, (cx, cy - 2), "PROJET NON VISIBLE", 8, BOLD, align="center"); txt(pg, (cx, cy + 8), "SUR CETTE FACADE", 8, BOLD, align="center")


def facades(doc, d):
    """Une page par façade qui montre le projet : avant à gauche, après à droite."""
    mai = d["maison"]["contour"]; p = d["projet"]; mm = d["maison"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    k = PT_PER_M_100; c = centroid(mai)
    noms = noms_facades(d)
    for ia, (a, b) in enumerate(edges(mai)):
        nv = normale_ext(mai, a, b)
        existantes = mm.get("ouvertures", {}).get(noms[ia], [])
        t = unit(sub(b, a)); t = (-nv[1], nv[0])     # axe horizontal vu de l'extérieur (gauche -> droite)
        proj = lambda q: q[0] * t[0] + q[1] * t[1]
        hx = [proj(q) for q in mai]; px = [proj(q) for q in pc]
        lo, hi = min(hx + px), max(hx + px)
        pignon = abs(dist(a, b) - min(dist(*e) for e in edges(mai))) < 0.5
        visible = max(nv[0] * (q[0] - a[0]) + nv[1] * (q[1] - a[1]) for q in pc) > -0.05 or True
        pg = doc.new_page(width=W, height=H)
        nom = orientation(nv)
        for i, apres in enumerate((False, True)):
            ox = 140; sol = 360 + i * 330                   # avant en haut, après en dessous (comme le prestataire)
            X = lambda s: ox + (s - lo) * k
            g, f = mm["hauteur_gouttiere"], mm["hauteur_faitage"]
            h0, h1 = min(hx), max(hx)
            if pignon:
                pts = [(X(h0), sol), (X(h0), sol - g * k), ((X(h0) + X(h1)) / 2, sol - f * k), (X(h1), sol - g * k), (X(h1), sol)]
            else:
                pts = [(X(h0), sol), (X(h0), sol - g * k), (X(h0), sol - f * k), (X(h1), sol - f * k), (X(h1), sol - g * k), (X(h1), sol)]
            poly(pg, [pymupdf.Point(*q) for q in pts], fill=(0.95, 0.93, 0.86), width=1)
            if not pignon:   # pan de toiture vu de face, au-dessus de la gouttière
                pg.draw_rect(pymupdf.Rect(X(h0), sol - f * k, X(h1), sol - g * k), color=(0, 0, 0), fill=(0.72, 0.45, 0.35), width=1)
                yy = sol - g * k - 4
                while yy > sol - f * k + 2:                    # rangs de tuiles
                    pg.draw_line(pymupdf.Point(X(h0), yy), pymupdf.Point(X(h1), yy), color=(0.5, 0.3, 0.22), width=0.35); yy -= 4.5
            pg.draw_line(pymupdf.Point(ox - 30, sol), pymupdf.Point(X(hi) + 60, sol), width=1)
            mur0 = min(proj(a), proj(b))                     # bord gauche du mur, vu de l'extérieur
            for o in existantes:                             # portes et fenêtres lues sur la photo
                rr = pymupdf.Rect(X(mur0 + o["x0"]), sol - o["haut"] * k, X(mur0 + o["x1"]), sol - o["bas"] * k)
                menuiserie(pg, rr, o["type"], o.get("volets"), k)
            p0, p1 = min(px), max(px)
            recouvre = max(0, min(p1, h1) - max(p0, h0)) > 0.3   # le projet passe derrière la maison
            devant = sum(nv[0] * (q[0] - a[0]) + nv[1] * (q[1] - a[1]) for q in pc) / 4 > -0.05 or not recouvre
            r = pymupdf.Rect(X(p0), sol - p["hauteur"] * k, X(p1), sol)
            if apres:
                prof_pts = [pymupdf.Point(*q) for q in profil_projet(p, r.x0, r.x1, sol, k, haut_cote_gauche=(r.x0 + r.x1) / 2 > (X(h0) + X(h1)) / 2)]
                if devant: poly(pg, prof_pts, fill=(0.83, 0.78, 0.66), width=1)
                for yy in range(int(r.y0) + 6, int(r.y1), 6):
                    if devant: pg.draw_line(pymupdf.Point(r.x0, yy), pymupdf.Point(r.x1, yy), color=(0.6, 0.55, 0.45), width=0.3)
                for o in p.get("ouvertures", []):
                    face_ok = (o["face"] == "exterieure" and ia == p["implantation"]["arete"]) or orientation(nv).replace(" ", "_").lower() == o["face"]
                    if devant and face_ok and o.get("largeur"):
                        cx = (r.x0 + r.x1) / 2
                        ro = pymupdf.Rect(cx - o["largeur"] * k / 2, sol - o["hauteur"] * k, cx + o["largeur"] * k / 2, sol)
                        if o.get("libre"): pg.draw_rect(ro, color=(0, 0, 0), fill=(0.25, 0.25, 0.25), width=0.8)
                        else: menuiserie(pg, ro, o.get("genre", "porte"), False, k)
                if devant: txt(pg, (r.x0 - 4 if r.x0 > X(h0) + 20 else r.x1 + 4, r.y0 - 4), niv(p["hauteur"]), 7.5, align="right" if r.x0 > X(h0) + 20 else "left")
                if not devant: etiquette_non_visible(pg, (X(h0) + X(h1)) / 2, sol - (g + f) / 2 * k)
            elif devant:
                pg.draw_rect(r, color=RED, width=0.8, dashes="[4 3] 0")
                txt(pg, ((r.x0 + r.x1) / 2, r.y0 - 5), "EMPLACEMENT PROJET", 6.5, BOLD, RED, align="center")
            txt(pg, (X(h1) + 6, sol - f * k + 4), niv(f), 7.5); txt(pg, (X(h1) + 6, sol - g * k + 4), niv(g), 7.5)
            txt(pg, (X(h1) + 6, sol + 4), "±0.00m", 7.5)
            ty = sol - mm["hauteur_faitage"] * k - 50
            txt(pg, (ox, ty), f"{'b' if apres else 'a'}  FACADE {nom} : {'APRES' if apres else 'AVANT'} PROJET", 10, BOLD)
            txt(pg, (ox, ty + 14), f"(façade {noms[ia].replace('arriere', 'arrière')} vue depuis la rue)" if noms[ia] in ("gauche", "droite") else f"(façade {noms[ia].replace('arriere', 'arrière')})", 8, color=GREY)
        note_projet(pg, d, 870, 600, 290)
        txt(pg, (870, 590), f"Maison : toiture {mm['toiture']}, {mm['facade']}", 7.5)
        echelle_graphique(pg, 80, 735, k)
        cartouche(pg, "FACADES", "100", "DP 4")


def volume_projet(p, pc, L):
    """Faces 3D du projet : toit plat, une pente (haut côté maison) ou deux pentes (faîtage dans la longueur)."""
    h = p["hauteur"]; e = p.get("hauteur_egout") or h
    q = [L(x) for x in pc]                    # q0-q1 le long de la maison, q3-q2 côté extérieur
    if p.get("toit") == "deux_pentes":
        m0, m1 = mul(add(q[0], q[3]), 0.5), mul(add(q[1], q[2]), 0.5)
        murs = [[(*q[i], 0), (*q[(i + 1) % 4], 0), (*q[(i + 1) % 4], e), (*q[i], e)] for i in range(4)]
        return murs + [[(*q[0], e), (*q[1], e), (*m1, h), (*m0, h)], [(*q[3], e), (*q[2], e), (*m1, h), (*m0, h)],
                       [(*q[1], e), (*q[2], e), (*m1, h)], [(*q[3], e), (*q[0], e), (*m0, h)]]
    z = [h, h, e, e] if p.get("toit") == "une_pente" else [h] * 4
    murs = [[(*q[i], 0), (*q[(i + 1) % 4], 0), (*q[(i + 1) % 4], z[(i + 1) % 4]), (*q[i], z[i])] for i in range(4)]
    return murs + [[(*q[i], z[i]) for i in range(4)]]


def vues_3d(doc, d, tmp):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    mai = d["maison"]["contour"]; p = d["projet"]; mm = d["maison"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    c = centroid(mai)
    L = lambda q: (q[0] - c[0], q[1] - c[1])
    def boite(pts, h):
        q = [L(x) for x in pts]
        faces = [[(*q[i], 0), (*q[(i + 1) % 4], 0), (*q[(i + 1) % 4], h), (*q[i], h)] for i in range(4)]
        return faces + [[(*x, h) for x in q]]
    ee = edges(mai); lo = max(range(4), key=lambda i: dist(*ee[i]))
    g, f = mm["hauteur_gouttiere"], mm["hauteur_faitage"]
    a1, b1 = ee[lo]; a2, b2 = ee[(lo + 2) % 4]
    r1, r2 = mul(add(a1, b2), 0.5), mul(add(b1, a2), 0.5)
    murs = boite(mai, g)[:4]
    toit = [[(*L(a1), g), (*L(b1), g), (*L(r2), f), (*L(r1), f)], [(*L(a2), g), (*L(b2), g), (*L(r1), f), (*L(r2), f)]]
    pignons = [[(*L(b1), g), (*L(a2), g), (*L(r2), f)], [(*L(b2), g), (*L(a1), g), (*L(r1), f)]]
    # Tout est trié à la main (peintre) : murs, toits, projet et menuiseries, pour que les fenêtres restent sur leur mur.
    noms = noms_facades(d); faces = []          # (polygone 3D, couleur, mur parent ou None, normale)
    def nrm(poly3):
        (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = poly3[0], poly3[1], poly3[2]
        ux, uy, uz = x1 - x0, y1 - y0, z1 - z0; vx, vy, vz = x2 - x0, y2 - y0, z2 - z0
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx; l_ = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
        return (nx / l_, ny / l_, nz / l_)
    def ext(poly3, centre):                      # normale tournée vers l'extérieur du volume
        nn = nrm(poly3); cx = sum(q[0] for q in poly3) / len(poly3); cy = sum(q[1] for q in poly3) / len(poly3)
        return nn if nn[0] * (cx - centre[0]) + nn[1] * (cy - centre[1]) + nn[2] * 0.001 >= 0 else (-nn[0], -nn[1], -nn[2])
    cm = L(centroid(mai)); cpj = L(centroid(pc))
    for w in murs + pignons: faces.append((w, (0.95, 0.92, 0.82), None, ext(w, cm)))
    for t_ in toit: faces.append((t_, (0.66, 0.38, 0.29), None, (0, 0, 1)))
    vp = volume_projet(p, pc, L)
    for w in vp:
        nn = ext(w, cpj) if abs(nrm(w)[2]) < 0.9 else (0, 0, 1)
        faces.append((w, (0.86, 0.80, 0.66) if abs(nn[2]) < 0.9 else (0.3, 0.3, 0.32) if p.get("toit") == "plat" else (0.66, 0.38, 0.29), None, nn))
    # menuiseries de la maison, posées 3 cm devant leur mur
    for ia, (a, b) in enumerate(edges(mai)):
        nv = normale_ext(mai, a, b); t = (-nv[1], nv[0])
        gauche = a if a[0] * t[0] + a[1] * t[1] < b[0] * t[0] + b[1] * t[1] else b
        for o in mm.get("ouvertures", {}).get(noms[ia], []):
            q0 = add(add(gauche, mul(t, o["x0"])), mul(nv, 0.03)); q1 = add(add(gauche, mul(t, o["x1"])), mul(nv, 0.03))
            col = (0.62, 0.74, 0.84) if o["type"] in ("fenetre", "porte_fenetre", "baie") else (0.97, 0.97, 0.95)
            faces.append(([(*L(q0), o["bas"]), (*L(q1), o["bas"]), (*L(q1), o["haut"]), (*L(q0), o["haut"])], col, ia, (nv[0], nv[1], 0)))
    # ouvertures du projet sur sa face extérieure
    fa, fb = pc[3], pc[2]; uo = unit(sub(fb, fa)); no = n
    for o in p.get("ouvertures", []):
        if not o.get("largeur"): continue
        m0 = mul(add(fa, fb), 0.5)
        q0 = add(add(m0, mul(uo, -o["largeur"] / 2)), mul(no, 0.03)); q1 = add(add(m0, mul(uo, o["largeur"] / 2)), mul(no, 0.03))
        faces.append(([(*L(q0), 0), (*L(q1), 0), (*L(q1), o["hauteur"]), (*L(q0), o["hauteur"])], (0.22, 0.22, 0.22), "projet", (no[0], no[1], 0)))
    soleil = (-0.45, -0.6, 0.66)
    out = []
    for i, (az, el) in enumerate([(-35, 30), (145, 30)]):
        cam = (math.cos(math.radians(el)) * math.cos(math.radians(az)), math.cos(math.radians(el)) * math.sin(math.radians(az)), math.sin(math.radians(el)))
        fig = plt.figure(figsize=(8, 5.6), dpi=150); ax = fig.add_subplot(projection="3d"); ax.computed_zorder = False
        pl = [L(q) for q in d["parcelle"]]
        Rs = max(7, max(abs(v) for q in mai + pc for v in L(q)) + 1)
        pl = [(max(-Rs, min(Rs, x)), max(-Rs, min(Rs, y))) for x, y in pl]          # terrain coupé au cadre
        ax.add_collection3d(Poly3DCollection([[(x, y, 0) for x, y in pl]], facecolors=(0.84, 0.92, 0.80), edgecolors=(0.8, 0.1, 0.1), linewidths=1.4))
        def prof(fc):
            poly3, _, parent, _ = fc
            cx = sum(q[0] for q in poly3) / len(poly3); cy = sum(q[1] for q in poly3) / len(poly3); cz = sum(q[2] for q in poly3) / len(poly3)
            return cx * cam[0] + cy * cam[1] + cz * cam[2]
        murs_prof = {}
        for fc in faces:
            if fc[2] is None: pass
        visibles = []
        for k_, fc in enumerate(faces):
            poly3, col, parent, nn = fc
            if parent is not None and nn[0] * cam[0] + nn[1] * cam[1] + nn[2] * cam[2] <= 0: continue   # menuiserie d'un mur caché
            if parent is None: dpt = prof(fc)
            elif parent == "projet": dpt = max(prof((w, None, None, None)) for w in vp if abs(nrm(w)[2]) < 0.9 and abs(ext(w, cpj)[0] * no[0] + ext(w, cpj)[1] * no[1]) > 0.9) + 0.01
            else: dpt = prof((murs[parent], None, None, None)) + 0.01
            ombre = 0.72 + 0.28 * max(0, nn[0] * soleil[0] + nn[1] * soleil[1] + nn[2] * soleil[2])
            visibles.append((dpt, poly3, tuple(min(1, c_ * ombre) for c_ in col), parent))
        for dpt, poly3, col, parent in sorted(visibles, key=lambda x: x[0]):
            ax.add_collection3d(Poly3DCollection([poly3], facecolors=col, edgecolors=(0.15, 0.15, 0.15), linewidths=0.4 if parent is not None else 0.7))
        R = max(7, max(abs(v) for q in mai + pc for v in L(q)) + 1)
        ax.set_xlim(-R, R); ax.set_ylim(-R, R); ax.set_zlim(0, R)
        ax.set_box_aspect((1, 1, 0.5), zoom=1.6); ax.view_init(el, az); ax.set_axis_off(); ax.set_position([0, 0, 1, 1])
        fn = os.path.join(tmp, f"3d_{i}.png"); fig.savefig(fn, bbox_inches="tight", transparent=True); plt.close(fig); out.append(fn)
    pg = doc.new_page(width=W, height=H)
    pg.insert_image(pymupdf.Rect(40, 80, 580, 700), filename=out[0]); pg.insert_image(pymupdf.Rect(600, 80, 1140, 700), filename=out[1])
    txt(pg, (60, 70), "VUES 3D", 11, BOLD); txt(pg, (60, 84), "Volumes à l'échelle, d'après le cadastre et les mesures de la fiche", 8, color=GREY)
    cartouche(pg, "VUES 3D", "---", "DP 5")


def insertion(doc, d, photos):
    pg = doc.new_page(width=W, height=H)
    f = photos and os.path.join(photos, "insertion.png")
    if f and os.path.exists(f):
        pg.insert_image(pymupdf.Rect(200, 40, 990, 740), filename=f)
    else:
        a_faire(pg, (380, 360), "Photomontage : photo « vue d'ensemble » + IA d'édition d'image.")
    cartouche(pg, "INSERTION PAYSAGERE", "---", "DP 6")


def photos_page(doc, d, photos):
    pg = doc.new_page(width=W, height=H)
    pres, loin = [photos and os.path.join(photos, x) for x in ("photo_pres.png", "photo_loin.png")]
    if pres and os.path.exists(pres): pg.insert_image(pymupdf.Rect(40, 70, 590, 470), filename=pres)
    if loin and os.path.exists(loin): pg.insert_image(pymupdf.Rect(620, 70, 1150, 470), filename=loin)
    txt(pg, (40, 495), "a  DP 7 : VUE DE PRES", 10, BOLD); txt(pg, (620, 495), "b  DP 8 : VUE DE LOIN", 10, BOLD)
    cartouche(pg, "VUE DE PRES - VUE DE LOIN", "---", "DP 7 / 8")


def notice(doc, d):
    p = d["projet"]; mm = d["maison"]; cad = d["cadastre"]; surf = p["largeur"] * p["profondeur"]
    blocs = [
        ("ETAT DES LIEUX", f"Le terrain se trouve à {d['commune']} et est désigné au cadastre par la feuille {cad['feuille']}, "
         f"parcelle {cad['numero']}.\nBâtiment existant : toiture en {mm['toiture']}, façade en {mm['facade']}, menuiseries {mm['menuiseries']}."),
        ("PROJET", f"Le projet consiste en la {p['libelle'].lower().replace('construction', 'construction', 1)} d'une surface d'environ "
         f"{str(round(surf, 2)).replace(".", ",")} m², {p['implantation']['texte']}.\nLa construction présentera une emprise au sol de {m(p['largeur'])} de largeur "
         f"sur {m(p['profondeur'])} de profondeur, pour une hauteur de {m(p['hauteur'])}.\n{p['toiture'][0].upper() + p['toiture'][1:]}. "
         "Les eaux pluviales seront collectées et évacuées vers le réseau pluvial existant.\n"
         f"Parois : {p['parois']}.\n" +
         "".join((f"{nom_ouverture(o)} de {m(o['largeur'])} de largeur et {m(o['hauteur'])} de hauteur.\n" if o.get("largeur") else f"Ouverture : {o['type']}.\n") for o in p.get("ouvertures", [])) +
         "L'ensemble du projet adoptera des teintes et des matériaux sobres, en harmonie avec l'architecture existante."),
        ("SURFACES", f"Emprise au sol créée : {str(round(surf, 2)).replace(".", ",")} m². Surface de plancher créée : 0 m² (construction non close de plain-pied "
         "à vérifier selon l'usage)." if False else f"Emprise au sol créée : {str(round(surf, 2)).replace(".", ",")} m²."),
        ("AUTRES", f"Surface du terrain : {cad['surface_terrain_m2']} m².\n"
         f"{'Des arbres seront abattus.' if p.get('arbres_abattus') else 'Aucun arbre ne sera abattu.'}\n"
         f"La maison est raccordée aux réseaux : {p['reseaux']}."),
    ]
    pg = doc.new_page(width=W, height=H)
    y = 70
    for titre, corps in blocs:
        pg.draw_rect(pymupdf.Rect(60, y, 260, y + 26), color=None, fill=(0.4, 0.4, 0.4))
        txt(pg, (70, y + 18), titre, 11, BOLD, (1, 1, 1))
        r = pymupdf.Rect(280, y, 1130, y + 150)
        left = pg.insert_textbox(r, corps, fontsize=10.5, fontname=FONT)
        y += 150 - max(0, left) + 22
    cartouche(pg, "NOTICE ARCHITECTURALE", "---", "DP 11")


def generer(d, sortie, photos=None):
    import tempfile
    doc = pymupdf.open()
    tmp = tempfile.mkdtemp()
    page_garde(doc, d); dp1(doc, d); plan_masse(doc, d, False); plan_masse(doc, d, True)
    coupe(doc, d); facades(doc, d); vues_3d(doc, d, tmp); insertion(doc, d, photos); photos_page(doc, d, photos); notice(doc, d)
    doc.save(sortie, garbage=3, deflate=True)
    return doc.page_count


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("entree"); ap.add_argument("sortie"); ap.add_argument("--photos")
    a = ap.parse_args()
    print(generer(json.load(open(a.entree)), a.sortie, a.photos), "pages")
