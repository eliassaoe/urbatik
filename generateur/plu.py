"""Vérification d'urbanisme automatique, avant la relecture humaine (décision du gérant, 18 nov. 2026).

1. Les faits officiels, du Géoportail de l'Urbanisme (API Carto IGN, gratuite, sans clé) :
   document d'urbanisme (PLU, PLUi, carte communale, ou RNU), zone de la parcelle, lien vers le
   règlement, servitudes (abords de monument historique, site classé ou inscrit, site patrimonial
   remarquable → avis de l'Architecte des Bâtiments de France), risques (PPR) et prescriptions
   (espace boisé classé, élément de patrimoine, jardin protégé…).
2. Le règlement de la zone : le PDF est téléchargé, la partie de la zone est extraite, puis l'IA
   (action « plu » de dossier-ia, la clé reste dans Supabase) la compare au projet et classe chaque
   règle : conforme / à vérifier / non conforme, avec l'article cité.

Rien ici n'est bloquant pour la génération : tout finit dans la liste « à vérifier » et dans le
résultat `plu` de la génération, affiché dans l'espace admin. Un « non conforme » est en tête de liste.
"""
import io, json, re, urllib.parse, urllib.request

API = "https://apicarto.ign.fr/api/gpu"
GPU_FICHIERS = "https://data.geopf.fr/annexes/gpu/documents"

# Servitudes qui changent la procédure (code de l'urbanisme / du patrimoine).
SERVITUDES = {
    "ac1": "Abords d'un monument historique : avis de l'Architecte des Bâtiments de France (instruction +1 mois)",
    "ac2": "Site classé ou inscrit : avis de l'Architecte des Bâtiments de France ou autorisation spéciale",
    "ac4": "Site patrimonial remarquable : avis conforme de l'Architecte des Bâtiments de France (instruction +1 mois)",
    "pm1": "Plan de prévention des risques naturels : règles du PPR à respecter (pièce à joindre possible)",
    "pm3": "Plan de prévention des risques technologiques",
    "el7": "Alignement de voirie",
    "i4": "Ligne électrique (servitude de distance)",
    "int1": "Voisinage d'un cimetière",
}


def _get(chemin, **params):
    url = f"{API}/{chemin}?" + urllib.parse.urlencode(params)
    for i in range(3):
        try:
            return json.loads(urllib.request.urlopen(url, timeout=40).read())
        except Exception:
            if i == 2: raise
    return {}


def _props(rep):
    return [f.get("properties", {}) for f in (rep or {}).get("features", [])]


def localiser(adresse):
    q = urllib.parse.quote(adresse)
    f = json.loads(urllib.request.urlopen(f"https://api-adresse.data.gouv.fr/search/?q={q}&limit=1", timeout=40).read())["features"][0]
    lon, lat = f["geometry"]["coordinates"]
    return lon, lat, f["properties"].get("citycode", "")


def faits(lon, lat, insee):
    """Ce que dit le Géoportail de l'Urbanisme au point du chantier. Chaque appel peut échouer seul."""
    g = json.dumps({"type": "Point", "coordinates": [lon, lat]})
    out = {"document": None, "zone": None, "reglement_url": None, "rnu": None, "servitudes": [], "prescriptions": [], "erreurs": []}
    try:
        m = _props(_get("municipality", insee=insee))
        out["rnu"] = bool(m and m[0].get("is_rnu"))
    except Exception as e: out["erreurs"].append(f"commune : {type(e).__name__}")
    try:
        docs = _props(_get("document", geom=g))
        if docs: out["document"] = {"type": docs[0].get("du_type"), "titre": docs[0].get("grid_title"), "id": docs[0].get("gpu_doc_id")}
    except Exception as e: out["erreurs"].append(f"document : {type(e).__name__}")
    try:
        zones = [z for z in _props(_get("zone-urba", geom=g)) if str(z.get("partition", "")).startswith("DU_")] or _props(_get("zone-urba", geom=g))
        if zones:
            z = zones[0]
            out["zone"] = {"code": z.get("libelle"), "nom": z.get("libelong"), "type": z.get("typezone")}
            if z.get("urlfic"): out["reglement_url"] = z["urlfic"]
            elif z.get("nomfic") and z.get("gpu_doc_id") and z.get("partition"):
                out["reglement_url"] = f"{GPU_FICHIERS}/{z['partition']}/{z['gpu_doc_id']}/{z['nomfic']}"
    except Exception as e: out["erreurs"].append(f"zone : {type(e).__name__}")
    try:
        cc = _props(_get("secteur-cc", geom=g))
        if cc and not out["zone"]:
            out["zone"] = {"code": cc[0].get("libelle"), "nom": cc[0].get("libelong") or "Secteur de carte communale", "type": cc[0].get("typesect")}
    except Exception: pass
    vus = set()
    for couche in ("assiette-sup-s", "assiette-sup-l", "assiette-sup-p"):
        try:
            for s in _props(_get(couche, geom=g)):
                t = str(s.get("suptype", "")).lower()
                cle = (t, s.get("nomsuplitt"))
                if cle in vus: continue
                vus.add(cle)
                out["servitudes"].append({"type": t, "nom": s.get("nomsuplitt") or s.get("nomass") or t.upper(),
                                          "effet": SERVITUDES.get(t, "Servitude d'utilité publique : vérifier ses règles")})
        except Exception as e: out["erreurs"].append(f"{couche} : {type(e).__name__}")
    for couche in ("prescription-surf", "prescription-lin", "prescription-pct"):
        try:
            for p in _props(_get(couche, geom=g)):
                lib = p.get("libelle") or p.get("txt")
                if lib and lib not in out["prescriptions"] and "stationnement" not in lib.lower():
                    out["prescriptions"].append(lib)
        except Exception: pass
    out["abf"] = any(s["type"] in ("ac1", "ac2", "ac4") for s in out["servitudes"])
    return out


def extrait_reglement(url, code_zone, limite=60000):
    """Le texte du règlement qui concerne la zone (+ les dispositions communes), limité pour l'IA."""
    import fitz  # pymupdf, installé par le workflow
    pdf = urllib.request.urlopen(url, timeout=120).read()
    doc = fitz.open(stream=pdf, filetype="pdf")
    pages = [doc[i].get_text() for i in range(doc.page_count)]
    code = re.escape(str(code_zone or "").strip())
    if not code: return ""
    # Début du chapitre de la zone : une page qui l'annonce en titre (on saute le sommaire, souvent les 6 premières pages).
    titre = re.compile(rf"(?im)^\s*(?:chapitre[^\n]*\n\s*)?(?:dispositions applicables (?:à|a)\s+la\s+)?zone\s+{code}\b")
    simple = re.compile(rf"(?m)^\s*{code}\s*[-–:]")
    debut = next((i for i, t in enumerate(pages) if i > 4 and titre.search(t)), None)
    if debut is None: debut = next((i for i, t in enumerate(pages) if i > 4 and simple.search(t)), None)
    morceaux = []
    if debut is not None:
        autre = re.compile(r"(?im)^\s*(?:dispositions applicables (?:à|a)\s+la\s+)?zone\s+(?!" + code + r"\b)[A-Z0-9]{1,6}[a-z]?\b")
        texte = ""
        for i in range(debut, min(debut + 40, len(pages))):
            if i > debut + 2 and autre.search(pages[i][:400]): break
            texte += f"\n[page {i + 1}]\n" + pages[i]
        morceaux.append(texte)
    # Dispositions communes / générales : souvent la hauteur, les reculs, les clôtures, les annexes.
    commun = next((i for i, t in enumerate(pages) if i > 3 and re.search(r"(?i)dispositions (?:communes|générales|generales)", t[:600])), None)
    if commun is not None:
        morceaux.append("".join(f"\n[page {i + 1}]\n" + pages[i] for i in range(commun, min(commun + 8, len(pages)))))
    t = "\n\n=== DISPOSITIONS COMMUNES ===\n".join(morceaux)
    return re.sub(r"[ \t]+", " ", t)[:limite]


def projet_pour_ia(cmd, d):
    f = cmd.get("fiche_technique") or {}
    p = d.get("projet", {})
    aire = lambda poly: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2 if poly else None
    terrain = d.get("cadastre", {}).get("surface_terrain_m2")
    maison = aire(d.get("maison", {}).get("contour"))
    emprise_projet = (p.get("largeur") or 0) * (p.get("profondeur") or 0) or cmd.get("surface_m2")
    return {
        "dossier": cmd.get("type_dossier"), "ouvrage": cmd.get("type_ouvrage"), "description": cmd.get("description"),
        "surface_m2": cmd.get("surface_m2"), "hauteur_m": cmd.get("hauteur_m"),
        "largeur_m": p.get("largeur"), "profondeur_m": p.get("profondeur"), "toit": p.get("toit"),
        "implantation": f.get("implantation"), "facade_accroche": f.get("facade_accroche"),
        "distances_limites_m": {k[5:-2]: f.get(k) for k in ("dist_avant_m", "dist_arriere_m", "dist_gauche_m", "dist_droite_m") if f.get(k) is not None},
        "materiaux": cmd.get("materiaux"), "couleurs": cmd.get("couleurs"),
        "surface_terrain_m2": terrain, "emprise_maison_m2": round(maison, 1) if maison else None,
        "emprise_projet_m2": round(float(emprise_projet), 1) if emprise_projet else None,
        "emprise_totale_pct": round(100 * (maison + float(emprise_projet)) / float(terrain), 1) if (maison and emprise_projet and terrain) else None,
        "hauteur_maison_faitage_m": d.get("maison", {}).get("hauteur_faitage"),
    }


def verifier(cmd, d, appel):
    """Renvoie (resultat_plu, lignes_a_verifier). `appel` = l'appel à dossier-ia de ci.py."""
    lignes = []
    try:
        lon, lat, insee = localiser(f"{cmd['adresse_chantier']} {cmd['code_postal']} {cmd['ville']}")
        fx = faits(lon, lat, insee)
    except Exception as e:
        return {"erreur": f"Géoportail de l'Urbanisme injoignable ({type(e).__name__})"}, ["PLU non vérifié automatiquement (Géoportail injoignable) : à vérifier à la main."]
    doc, zone = fx.get("document"), fx.get("zone")
    if fx.get("rnu") and not doc:
        lignes.append("PLU : pas de document d'urbanisme, la commune applique le règlement national d'urbanisme (RNU).")
    elif zone:
        lignes.append(f"PLU : zone {zone.get('code')} ({zone.get('nom') or zone.get('type')}) du {(doc or {}).get('type') or 'document'}"
                      f"{' ' + doc['titre'] if doc and doc.get('titre') else ''}.")
        if str(zone.get("type", "")).upper() in ("A", "N"):
            lignes.insert(0, f"⚠ PLU : zone {zone.get('type')} (agricole ou naturelle) : constructions très limitées, vérifier que le projet y est autorisé.")
    else:
        lignes.append("PLU : zone introuvable sur le Géoportail : à vérifier en mairie.")
    for s in fx["servitudes"]:
        lignes.insert(0 if s["type"] in ("ac1", "ac2", "ac4") else len(lignes), f"⚠ {s['nom']} : {s['effet']}.")
    if fx["prescriptions"]:
        lignes.append("Prescriptions du PLU sur la parcelle : " + " ; ".join(fx["prescriptions"][:6]) + ".")

    regles = None
    if fx.get("reglement_url") and zone and zone.get("code"):
        try:
            texte = extrait_reglement(fx["reglement_url"], zone["code"])
            if len(texte) > 500:
                regles = appel("plu", zone=f"{zone.get('code')} ({zone.get('nom') or ''})", texte=texte,
                               projet=projet_pour_ia(cmd, d), contexte={"abf": fx["abf"], "servitudes": [s["nom"] for s in fx["servitudes"]]})
            else:
                lignes.append("Règlement de la zone non trouvé dans le PDF : règles à lire à la main.")
        except Exception as e:
            lignes.append(f"Règlement non analysé ({type(e).__name__}) : règles à lire à la main.")
    elif not fx.get("rnu"):
        lignes.append("Règlement du PLU non disponible en ligne : règles à lire à la main.")

    if regles and isinstance(regles.get("regles"), list):
        non = [r for r in regles["regles"] if r.get("verdict") == "non_conforme"]
        doute = [r for r in regles["regles"] if r.get("verdict") == "a_verifier"]
        for r in non:
            lignes.insert(0, f"⛔ PLU non conforme ({r.get('theme')}, {r.get('article') or 'article ?'}) : {r.get('regle')} — projet : {r.get('projet')}. {r.get('explication', '')}".strip())
        for r in doute:
            lignes.append(f"PLU à vérifier ({r.get('theme')}, {r.get('article') or 'article ?'}) : {r.get('regle')} — projet : {r.get('projet')}.")
        ok = len(regles["regles"]) - len(non) - len(doute)
        if ok: lignes.append(f"PLU : {ok} règle(s) vérifiée(s) conforme(s) par l'IA.")
    return {"faits": fx, "analyse": regles}, lignes
