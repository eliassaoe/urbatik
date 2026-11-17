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
    p1 = add(p0, mul(u, prof)); p2 = add(p1, mul(n, larg)); p3 = add(p0, mul(n, larg))
    return [p0, p1, p2, p3], u, n


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


def note_projet(page, d, x, y, w=300):
    p = d["projet"]; surf = p["largeur"] * p["profondeur"]
    lignes = [f"{p['libelle'].upper()} - {surf:.0f} m²",
              f"· DIMENSIONS : {m(p['largeur'])} (LARGEUR) × {m(p['profondeur'])} (PROFONDEUR).",
              f"· HAUTEUR : {m(p['hauteur'])}.",
              f"· IMPLANTATION : {p['implantation']['texte'].upper()}.",
              f"· {p['toiture'].upper()}.",
              f"· PAROIS : {p['parois'].upper()}."]
    for o in p.get("ouvertures", []):
        lignes.append(f"· {o['type'].upper()} : {m(o['largeur'])} × {m(o['hauteur'])}")
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
    a_faire(pg, (680, 300), "Vue aérienne IGN (orthophoto) : récupérée par le serveur en production.")
    txt(pg, (680, 280), "b  VUE AERIENNE", 11, BOLD)
    cartouche(pg, "PLAN DE SITUATION", "1000", "DP 1")


def plan_masse(doc, d, apres):
    pg = doc.new_page(width=W, height=H)
    mai = d["maison"]["contour"]; p = d["projet"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    # rotation : le long côté de la maison à la verticale, comme le prestataire
    e = max(edges(mai), key=lambda s: dist(*s))
    ang = math.pi / 2 - math.atan2(e[1][1] - e[0][1], e[1][0] - e[0][0])
    par = d["parcelle"]; c = centroid(par)
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
    # distances du projet aux limites
    for a, b in edges(par):
        dd = poly_dist_to_edge(pc, a, b)
        if 0.3 < dd < 6:
            q = min(pc, key=lambda q: seg_dist(q, a, b))
            ab = sub(b, a); t = ((q[0]-a[0])*ab[0] + (q[1]-a[1])*ab[1]) / (ab[0]**2 + ab[1]**2)
            foot = add(a, mul(ab, max(0, min(1, t))))
            cote(pg, v(q), v(foot), m(dd), off=0)
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
    pg.draw_rect(pymupdf.Rect(lx, ly, 1160, ly + 70), color=(0, 0, 0), width=0.5)
    txt(pg, (lx + 8, ly + 14), "Légende :", 8, BOLD)
    for i, (col, lab) in enumerate([(GREEN, "Espace vert"), (ROOF, "Bâti existant"), (DARK, "Projet")]):
        pg.draw_rect(pymupdf.Rect(lx + 10, ly + 22 + i * 15, lx + 40, ly + 31 + i * 15), color=None, fill=col)
        txt(pg, (lx + 48, ly + 30 + i * 15), f": {lab}", 8)
    fleche_nord(pg, (80, 90), ang)
    echelle_graphique(pg, 80, 735, PT_PER_M_100 * 100 / ech)
    a_faire(pg, (750, 150), "Réseaux (EP, EU, eau, électricité) et flèches photos DP7/DP8.")
    cartouche(pg, "PLAN DE MASSE " + ("APRES" if apres else "AVANT"), str(ech), "DP 2")


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
        # projet contre la maison
        px = mx - p["largeur"] * k
        if apres:
            pg.draw_rect(pymupdf.Rect(px, sol - p["hauteur"] * k, mx, sol), color=(0, 0, 0), fill=(0.55, 0.55, 0.55), width=1)
            txt(pg, (px - 52, sol - p["hauteur"] * k + 4), niv(p["hauteur"]), 8)
            cote(pg, pymupdf.Point(px, sol), pymupdf.Point(mx, sol), m(p["largeur"]), off=-22)
            note_projet(pg, d, 870, 600, 290)
        else:
            pg.draw_rect(pymupdf.Rect(px, sol - p["hauteur"] * k, mx, sol), color=RED, width=1, dashes="[4 3] 0")
            txt(pg, ((px + mx) / 2, sol - p["hauteur"] * k - 6), "EMPLACEMENT PROJET", 7, BOLD, RED, align="center")
        txt(pg, (70, sol - 4), "TN ±0.00", 8)
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
        mid_a = mul(add(pc[0], pc[1]), 0.5)
        g_lim = jusqu_a_limite(mid_a, dir_out); d_lim = jusqu_a_limite(add(mid_a, mul(dir_out, -larg_maison)), mul(dir_out, -1))
        for xl, lab in ((mx - g_lim * k, "Limite de propriété"), (mx + larg_maison * k + d_lim * k, "Limite de propriété")):
            pg.draw_line(pymupdf.Point(xl, sol + 10), pymupdf.Point(xl, sol - 130), color=(0, 0, 0), width=0.8, dashes="[6 2 1 2] 0")
            txt(pg, (xl + 3, sol - 120), lab, 7, rot=0)
        if g_lim > p["largeur"] + 0.05:
            cote(pg, pymupdf.Point(mx - g_lim * k, sol), pymupdf.Point(mx - p["largeur"] * k, sol), m(g_lim - p["largeur"]), off=-22)
        cote(pg, pymupdf.Point(mx + larg_maison * k, sol), pymupdf.Point(mx + larg_maison * k + d_lim * k, sol), m(d_lim), off=-22)
        txt(pg, (60, y0 - 250), ("b  COUPE : APRES PROJET" if apres else "a  COUPE : AVANT PROJET"), 10, BOLD)
    txt(pg, (870, 590), f"Toiture maison : {mm['toiture']} · façade : {mm['facade']}", 7.5)
    echelle_graphique(pg, 80, 735, k)
    cartouche(pg, "COUPE", "100", "DP 3")


def facades(doc, d):
    """Une page par façade qui montre le projet : avant à gauche, après à droite."""
    mai = d["maison"]["contour"]; p = d["projet"]; mm = d["maison"]
    pc, u, n = projet_contour(mai, p["implantation"], p["largeur"], p["profondeur"])
    k = PT_PER_M_100; c = centroid(mai)
    for a, b in edges(mai):
        nv = unit((b[1] - a[1], -(b[0] - a[0])))
        if (nv[0] * (c[0] - a[0]) + nv[1] * (c[1] - a[1])) > 0: nv = mul(nv, -1)
        t = unit(sub(b, a)); t = (-nv[1], nv[0])     # axe horizontal vu de l'extérieur (gauche -> droite)
        proj = lambda q: q[0] * t[0] + q[1] * t[1]
        hx = [proj(q) for q in mai]; px = [proj(q) for q in pc]
        lo, hi = min(hx + px), max(hx + px)
        pignon = abs(dist(a, b) - min(dist(*e) for e in edges(mai))) < 0.5
        visible = max(nv[0] * (q[0] - a[0]) + nv[1] * (q[1] - a[1]) for q in pc) > -0.05 or True
        pg = doc.new_page(width=W, height=H)
        nom = orientation(nv)
        for i, apres in enumerate((False, True)):
            ox = 70 + i * 520; sol = 560
            X = lambda s: ox + (s - lo) * k
            g, f = mm["hauteur_gouttiere"], mm["hauteur_faitage"]
            h0, h1 = min(hx), max(hx)
            if pignon:
                pts = [(X(h0), sol), (X(h0), sol - g * k), ((X(h0) + X(h1)) / 2, sol - f * k), (X(h1), sol - g * k), (X(h1), sol)]
            else:
                pts = [(X(h0), sol), (X(h0), sol - g * k), (X(h0), sol - f * k), (X(h1), sol - f * k), (X(h1), sol - g * k), (X(h1), sol)]
            poly(pg, [pymupdf.Point(*q) for q in pts], fill=(0.95, 0.93, 0.86), width=1)
            if not pignon:   # pan de toiture vu de face, au-dessus de la gouttière
                pg.draw_rect(pymupdf.Rect(X(h0), sol - f * k, X(h1), sol - g * k), color=(0, 0, 0), fill=(0.66, 0.4, 0.32), width=1)
            pg.draw_line(pymupdf.Point(ox - 20, sol), pymupdf.Point(ox + 460, sol), width=1)
            p0, p1 = min(px), max(px)
            recouvre = max(0, min(p1, h1) - max(p0, h0)) > 0.3   # le projet passe derrière la maison
            devant = sum(nv[0] * (q[0] - a[0]) + nv[1] * (q[1] - a[1]) for q in pc) / 4 > -0.05 or not recouvre
            r = pymupdf.Rect(X(p0), sol - p["hauteur"] * k, X(p1), sol)
            if apres:
                pg.draw_rect(r, color=(0, 0, 0), fill=(0.83, 0.78, 0.66) if devant else None, width=1,
                             dashes=None if devant else "[3 2] 0")
                for yy in range(int(r.y0) + 6, int(r.y1), 6):
                    if devant: pg.draw_line(pymupdf.Point(r.x0, yy), pymupdf.Point(r.x1, yy), color=(0.6, 0.55, 0.45), width=0.3)
                for o in p.get("ouvertures", []):
                    if devant and orientation(nv).replace(" ", "_").lower() == o["face"]:
                        cx = (r.x0 + r.x1) / 2
                        pg.draw_rect(pymupdf.Rect(cx - o["largeur"] * k / 2, sol - o["hauteur"] * k, cx + o["largeur"] * k / 2, sol), color=(0, 0, 0), fill=(0.3, 0.3, 0.3), width=0.8)
                if devant: txt(pg, (r.x0 - 4 if r.x0 > X(h0) + 20 else r.x1 + 4, r.y0 - 4), niv(p["hauteur"]), 7.5, align="right" if r.x0 > X(h0) + 20 else "left")
                if not devant: txt(pg, ((r.x0 + r.x1) / 2, r.y0 - 6), "PROJET NON VISIBLE SUR CETTE FACADE", 7, BOLD, align="center")
            else:
                pg.draw_rect(r, color=RED, width=0.8, dashes="[4 3] 0")
            txt(pg, (X(h1) + 6, sol - f * k + 4), niv(f), 7.5); txt(pg, (X(h1) + 6, sol - g * k + 4), niv(g), 7.5)
            txt(pg, (X(h1) + 6, sol + 4), "±0.00m", 7.5)
            txt(pg, (ox, 120), f"{'b' if apres else 'a'}  FACADE {nom} : {'APRES' if apres else 'AVANT'} PROJET", 10, BOLD)
        note_projet(pg, d, 870, 600, 290)
        txt(pg, (870, 590), f"Maison : toiture {mm['toiture']}, {mm['facade']}", 7.5)
        echelle_graphique(pg, 80, 735, k)
        cartouche(pg, "FACADES", "100", "DP 4")


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
    out = []
    for i, (az, el) in enumerate([(-35, 30), (145, 30)]):
        fig = plt.figure(figsize=(7, 5), dpi=130); ax = fig.add_subplot(projection="3d")
        ax.add_collection3d(Poly3DCollection(murs + pignons, facecolors=(0.95, 0.92, 0.82), edgecolors="k", linewidths=0.6))
        ax.add_collection3d(Poly3DCollection(toit, facecolors=(0.62, 0.36, 0.28), edgecolors="k", linewidths=0.6))
        pl = [L(q) for q in d["parcelle"]] + [L(d["parcelle"][0])]
        ax.plot([q[0] for q in pl], [q[1] for q in pl], [0] * len(pl), color=(0.8, 0.1, 0.1), lw=1.4)
        ax.add_collection3d(Poly3DCollection(boite(pc, p["hauteur"]), facecolors=(0.86, 0.80, 0.66), edgecolors="k", linewidths=0.7))
        R = 11; ax.set_xlim(-R, R); ax.set_ylim(-R, R); ax.set_zlim(0, R)
        ax.set_box_aspect((1, 1, 0.5)); ax.view_init(el, az); ax.set_axis_off()
        fn = os.path.join(tmp, f"3d_{i}.png"); fig.savefig(fn, bbox_inches="tight", transparent=True); plt.close(fig); out.append(fn)
    pg = doc.new_page(width=W, height=H)
    pg.insert_image(pymupdf.Rect(40, 80, 580, 700), filename=out[0]); pg.insert_image(pymupdf.Rect(600, 80, 1140, 700), filename=out[1])
    txt(pg, (60, 70), "VUES 3D (volumes)", 11, BOLD)
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
         "".join(f"{o['type'][0].upper() + o['type'][1:]} de {m(o['largeur'])} de largeur et {m(o['hauteur'])} de hauteur.\n" for o in p.get("ouvertures", [])) +
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
