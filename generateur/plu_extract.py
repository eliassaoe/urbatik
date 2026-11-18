"""Extrait le texte d'une zone du règlement du PLU pour la vérification AVANT paiement (fonction plu-check).

Lancé par .github/workflows/plu-extract.yml (repository_dispatch « plu-extract ») : le PDF du règlement est
trop lourd pour une Edge Function. Envoie le texte à plu-check, qui le garde en cache et lance l'analyse IA.
Le dépôt est public : rien de la commande n'est écrit dans les journaux (l'URL du règlement est publique).
"""
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import plu

API = os.environ.get("PLU_CHECK_URL", "https://snxhsboboatjywgwdeds.supabase.co/functions/v1/plu-check")


def envoyer(texte):
    req = urllib.request.Request(API, data=json.dumps({"action": "texte", "id": os.environ["CHECK_ID"], "token": os.environ["CHECK_TOKEN"],
                                                        "texte": texte}).encode(), headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=60).read()


if __name__ == "__main__":
    try:
        texte = plu.extrait_reglement(os.environ["REGLEMENT_URL"], os.environ["ZONE"])
        print(f"extrait : {len(texte)} caractères")
    except BaseException as e:
        texte = ""
        print(f"extraction impossible ({type(e).__name__})")
    envoyer(texte)
