"""Le générateur lancé par GitHub Actions (workflow generer-dossier.yml), pour une commande.

Reçoit GENERATION_ID et GENERATION_TOKEN (jeton à usage unique, 3 h). Toutes les données passent par
l'Edge Function dossier-ia : commande, photos, lecture des façades et photomontage (les clés IA restent
dans Supabase), puis le PDF est déposé dans le stockage privé.

Le dépôt est public, donc les journaux d'Actions aussi : ce script n'écrit RIEN de la commande
(ni nom, ni adresse, ni erreur détaillée) dans la sortie. Le détail d'un échec part à Supabase seulement.
"""
import io, json, os, sys, tempfile, traceback, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import dossier as D, depuis_commande as C, photomontage as P, vision as V

API = os.environ.get("DOSSIER_IA_URL", "https://snxhsboboatjywgwdeds.supabase.co/functions/v1/dossier-ia")
GID, TOK = os.environ["GENERATION_ID"], os.environ["GENERATION_TOKEN"]


def appel(action, **kw):
    req = urllib.request.Request(API, data=json.dumps({"action": action, "generation_id": GID, "token": TOK, **kw}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())


def telecharger(url):
    return urllib.request.urlopen(url, timeout=120).read()


def en_png(octets, sortie):
    from PIL import Image
    Image.open(io.BytesIO(octets)).convert("RGB").save(sortie, "PNG")


def main():
    rep = appel("commande")
    cmd, a_verifier = rep["commande"], []
    tmp = tempfile.mkdtemp()
    photos = os.path.join(tmp, "photos"); os.makedirs(photos)
    for ph in rep["photos"]:
        if not ph.get("url"): continue
        ext = {"image/png": ".png", "image/webp": ".webp"}.get(ph["type"], ".jpg")
        open(os.path.join(photos, ph["kind"] + ext), "wb").write(telecharger(ph["url"]))

    # Lecture des façades par l'IA, côté serveur (le nom du fichier est la sorte de photo).
    V.lire_facade = lambda chemin: appel("vision", kind=os.path.splitext(os.path.basename(chemin))[0])
    d = C.construire(cmd, photos, lire_photos=True)
    a_verifier += d.get("_a_verifier", [])

    # DP7 / DP8 : photo proche = vue d'ensemble, photo lointaine = vue depuis la rue.
    for sorte, nom in (("photo_ensemble", "photo_pres.png"), ("photo_rue", "photo_loin.png")):
        src = next((os.path.join(photos, x) for x in os.listdir(photos) if x.startswith(sorte)), None)
        if src: en_png(open(src, "rb").read(), os.path.join(photos, nom))
        else: a_verifier.append(f"Photo {sorte.replace('_', ' ')} absente : page photos à compléter.")

    # DP6 : photomontage.
    try:
        r = appel("photomontage", prompt=P.consigne(d))
        open(os.path.join(photos, "insertion.png"), "wb").write(telecharger(r["url"]))
        a_verifier.append("Photomontage DP6 fait par l'IA : vérifier proportions, couleurs et emplacement.")
    except Exception:
        a_verifier.append("Photomontage DP6 non produit : à faire à la main.")

    pdf = os.path.join(tmp, "dossier.pdf")
    D.generer(d, pdf, photos)
    up = appel("depot_url")
    req = urllib.request.Request(up["url"], data=open(pdf, "rb").read(), method="PUT", headers={"Content-Type": "application/pdf"})
    urllib.request.urlopen(req, timeout=120).read()
    appel("depot", a_verifier=a_verifier)


if __name__ == "__main__":
    try:
        main(); print("dossier généré et déposé")
    except Exception as e:
        detail = "".join(traceback.format_exception_only(type(e), e)).strip()[:400]
        try: appel("echec", message=detail)
        except Exception: pass
        print("échec (détail envoyé à Supabase)"); sys.exit(1)
