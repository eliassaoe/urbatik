# Explee auto-replies for Urba (14 Nov 2026)

- **creha.fr project (61157)** — this is the Urba outbound project. Auto-replies now send the site
  only (no calendar): text in `creha-61157-instructions.txt`. Booking link field set to the site.
  Previous booking link was a creHA Calendly (aurelie-dubois-creha/30min) and the old rules made
  every reply end with it; prices and refund are now given only when the lead asks.
- **linkfinderai.com project (30475)** — owner rule: do not touch. It was changed by mistake on
  14 Nov around 12:10 and restored at 13:05 (booking link and the exact 3000-character
  instructions, kept in `linkfinder-30475-instructions-original.txt`).

## 14 Nov 2026, 18:30 Paris: switched to urbatik.com (owner request)

Project creha.fr (61157) only, project 30475 untouched:
- Auto-reply instructions: the site link is now `https://urbatik.com/?utm_source=cold_email&utm_campaign=creha&utm_content=reponse` (copy in `creha-61157-instructions.txt`).
- Booking link: `https://urbatik.com/commande?utm_source=cold_email&utm_campaign=creha&utm_content=reponse`
  (Explee refuses a homepage in that field, so it points at the order form).
- Project docs → Company: name Urbatik, Stains, founded 2026, logo https://urbatik.com/og.png, description of the
  Urbatik service (creHA cited as partner, same wording as the site).
- Email sequences contain no link, nothing to change.

- 18:40: booking link changed to the Calendly event, renamed by the owner's request to "Appel avec Urbatik": `https://calendly.com/hamoureliasse/appel-avec-urbatik` (the old `appel-avec-urbaa` link no longer exists). The instructions still end every reply with the site link and never send a calendar link on their own.
- 18:45: owner's call — every reply now ends with the site first, then the Calendly as an option (to collect early feedback, not to sell). Full text in `creha-61157-instructions.txt`.
- 21:20 : décision du gérant, **ne jamais citer creHA** (site, mentions légales, profil Explee). Phrase retirée partout ; à la place : « relu par un professionnel de l'urbanisme ».

## 18 Nov 2026, 19:10 : prix du permis 790 → 390 € HT (décision du gérant)
Instructions du projet 61157 mises à jour (« 390 € HT le permis de construire »). L'éditeur de la page Auto-replies
n'enregistrait pas la modification (aucune requête envoyée) : fait par `PATCH /api/app-auto-gtm/projects/61157`
avec `{reply_instructions}` depuis la session du navigateur, relu ensuite. Copie dans `creha-61157-instructions.txt`.
