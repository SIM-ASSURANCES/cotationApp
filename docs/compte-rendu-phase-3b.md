# Compte rendu de la phase 3b : émission, assemblage, QR code, archivage

Écrit le 06/10/2026. Décisions : [decisions.md](decisions.md) (D16, D17, hypothèses H18 à H27). Vérifications : [recette.md](recette.md) (§2 quinquies et §3).

## Ce qui est fait

| Domaine | Livré |
| --- | --- |
| **Corrections** | champs obligatoires des CP, cotations et reçus (D16, correction de H15) ; décision du 06/10 sur les polices consignée (D16 : Dockerfile inchangé jusqu'au test D) |
| **Assemblage** (§6.8) | un seul PDF : CP → annexes → CS → CG ; CG/CS désignées dans le paramétrage du produit (références contractuelles : code du modèle et visa) ; **visa contrôlé, bloquant** |
| **QR code** (§14.1) | jeton de 256 bits par version de document ; adresse `URL_PUBLIQUE/verif/{jeton}` ; page publique avec statut en temps réel et souscripteur masqué ; page neutre pour un jeton inconnu ; 30 requêtes par minute et par adresse IP |
| **Empreinte, archivage** (§14.3) | SHA-256 du PDF final, enregistrée, affichée, **contrôlée à chaque téléchargement** ; stockage en ajout seul derrière une seule interface (volume du générateur) ; documents émis jamais modifiés ni supprimés en base |
| **Régénération** (T10) | versions exactes des modèles (principal, annexes, sous-modèles, CS, CG), date des paramètres et données conservées ; la réédition les reprend, avec un nouveau fichier et un nouveau jeton |
| **Cotation** | aperçu PDF (filigrane « APERÇU ») ; PDF émis aussitôt après l'émission ; réédition, avec « EXPIRÉE » si la cotation a expiré (T11) ; CP émises depuis la fiche d'une cotation acceptée |
| **Écrans** | « Documents émis » (recherche par police, numéro, client, type, période ; PDF ; ZIP de la sélection), « Société » (societe.*, lieu, signataire, signature et cachet), partie PDF de la fiche cotation, références contractuelles dans la version d'un produit, page publique /verif |

**T10, T11 (filigrane) et T12 sont verts** en tests automatisés. **Une cotation T1 complète produit un PDF dans la pile Docker** : montants identiques à T1, QR code lisible (décodé, il donne l'adresse de vérification), page /verif correcte, empreinte affichée égale au SHA-256 du PDF téléchargé.

## Fichiers principaux

- Application : `src/serveur/documents.ts` (émission, réédition, vérification, recherche), `stockage.ts` (interface unique), `societe.ts` ; `src/domaine/documents/emission.ts`, `donnees.ts`, `societe.ts` ; `src/domaine/limite.ts` ; écrans `documents/`, `parametrage/societe/`, `verif/[jeton]/` ; migration `documents_emis` (table en ajout seul, références contractuelles du produit).
- Générateur : `app/pdf.py` (QR code, filigrane, assemblage), `app/stockage.py` (ajout seul, ZIP), routes `/interne/stockage` ; modèle de test `cotation_test.docx`.
- Configuration : `URL_PUBLIQUE` (facultative : vide, rien ne s'émet ; voir `.env.example`, `app/.env.example`, `docker-compose.yml`).

## Tests

pytest 136 (conteneur) ; vitest 145 unitaires, 76 d'intégration, 5 de bout en bout ; recette T1 sur la pile Docker (parcours HTTP, `pdftotext`, `zbarimg`).

## Écarts et points à connaître

- **Hypothèses nouvelles H18 à H27** (D17), à faire confirmer. Les plus visibles : le numéro obligatoire d'une cotation est `doc.numero` (H18) ; un champ que l'application ne connaît pas s'écrit vide (H19) ; `doc.empreinte` ne peut pas figurer dans son propre document (H20) ; droits par type de document (H21).
- **Factures, reçus, avoirs** : phase 4. T12 est vérifié avec une facture inscrite directement en base ; l'annulation par avoir (`annulerParAvoir`) est prête pour la phase 4.
- **Retour à l'écran** : après la soumission d'une cotation, le message « PDF émis » ou « PDF non émis : … » disparaît avec le formulaire ; la liste des PDF de la fiche et le bouton « Émettre le PDF » en tiennent lieu.
- **Non vérifié par les écrans** : l'émission des CP (vérifiée par la base et le service), l'écran « Société » et les références contractuelles d'un produit (types et lint seulement).
- **Dockerfile** inchangé (D16) ; quand la police de remplacement de Tahoma sera choisie (test D), changer aussi les polices exigées par `/sante`.
- Numéros d'hypothèses : la phase 3a a utilisé H13 à H17 ; la 3b continue à H18.
