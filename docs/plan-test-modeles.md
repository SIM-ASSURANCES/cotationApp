# Plan : test de fidélité de tous les modèles Word, en une fois

À dérouler quand **tous les modèles sont réunis**, **avant le balisage** : il dit quels modèles posent problème à LibreOffice, pendant qu'il est encore temps d'en corriger la mise en page. Durée : une demi-heure, presque entièrement automatique.

Les deux scripts existent et ont été essayés sur un seul modèle (le CP, résultat « identique », 13 pages sur 13). Le lot complet n'a **pas** encore été lancé.

## Principe

1. **Word** exporte chaque `.docx` en PDF : c'est la référence (`generateur/scripts/exporter_word.ps1`, Word piloté par PowerShell).
2. **Le conteneur du générateur** convertit les mêmes `.docx` avec son LibreOffice, compare page par page, et sort un tableau (`generateur/scripts/test_fidelite_lot.py`).

Les modèles sont comparés **bruts** (balises `{{ }}` non remplacées, des deux côtés) : on mesure la mise en page, pas le contenu final. C'est suffisant pour repérer les problèmes de polices, de tableaux et de sauts de page. Un balisage fait ensuite changer les longueurs de texte : le résultat définitif se contrôle avec des documents remplis de données inventées (`test_fidelite.py`, un modèle à la fois).

## Avant de commencer (une fois)

| Étape | Détail |
| --- | --- |
| Dossier de travail **hors dépôt** | par exemple `C:\essais\modeles\` ; y copier **tous** les `.docx` (sous-dossiers acceptés). Jamais de données clients. |
| Polices Microsoft | les 21 fichiers sont dans `generateur/polices/` ; l'image doit être construite avec : `docker compose build generateur` |
| Word | fermer les documents ouverts qui ne sont pas à toi : le script ne touche pas aux fenêtres Word existantes, mais un fichier ouvert ailleurs peut l'empêcher d'ouvrir le modèle |
| Fichiers de verrouillage `~$...` | ignorés par les deux scripts |

## Déroulement

**1. Export Word (≈ 1 à 10 s par modèle).** Depuis la racine du dépôt, PowerShell :

```powershell
.\generateur\scripts\exporter_word.ps1 -Source C:\essais\modeles -Sortie C:\essais\pdf_word
```

Le script affiche « OK » et le nombre de pages selon Word pour chaque modèle, ou « ECHEC » avec la raison, puis continue. Code de sortie 1 s'il y a un échec. Les modèles sont ouverts en lecture seule et jamais enregistrés.

**2. Conversion dans le conteneur et comparaison (≈ 5 à 20 s par modèle).**

```powershell
docker compose run --rm -v C:\essais:/essais generateur python scripts/test_fidelite_lot.py --modeles /essais/modeles --pdf-word /essais/pdf_word --sortie /essais/pdf_libreoffice
```

Les PDF produits par LibreOffice restent dans `C:\essais\pdf_libreoffice\` pour un contrôle visuel.

> Si le dossier des scripts de l'image est plus ancien que le dépôt, reconstruire l'image (`docker compose build generateur`) ou monter le dossier : `-v ${PWD}\generateur\scripts:/srv/generateur/scripts:ro`.

**3. Lire le tableau.** Une ligne par modèle : pages Word, pages LibreOffice, fins de page identiques (ex. `11/13`), pages décalées, polices de Word absentes du rendu, verdict :

| Verdict | Sens | Suite |
| --- | --- | --- |
| identique | mêmes pages, mêmes fins de page | rien à faire |
| ÉCART (fins de page) | même nombre de pages, du texte glisse | ouvrir les deux PDF aux pages listées ; chercher la cause (étape 4) |
| ÉCART (pages) | nombre de pages différent | idem, c'est le cas le plus grave |
| ERREUR | conversion impossible, ou PDF Word absent | voir le message ; relancer l'export Word pour ce modèle |

**4. Pour chaque modèle en écart.** Dans l'ordre :

1. Comparer visuellement le PDF Word et le PDF LibreOffice aux pages décalées (c'est souvent un tableau, un retrait ou une police).
2. Regarder la colonne « Polices absentes » : une police de Word absente du rendu est la première suspecte. Si c'est une police non fournie (hors Calibri, Tahoma, Symbol, Arial…), l'ajouter à `generateur/polices/` (voir son README et la question Q2 sur la licence), reconstruire l'image, relancer.
3. Si les polices sont bonnes, corriger la **mise en page du modèle** (tableaux à largeur fixe, sauts de page explicites, éviter les espacements créés par des paragraphes vides), puis refaire les étapes 1 et 2 **pour ce modèle seul** (un dossier de test réduit).
4. Consigner le modèle, la cause et la correction dans la recette.

**5. Consigner dans `docs/recette.md`** (section 1.2) : date, version de LibreOffice de l'image, tableau complet, et la liste des modèles encore en écart avec leur cause connue ou « non expliquée ».

## Critère d'acceptation

Tous les modèles à **verdict « identique »**, ou écarts expliqués et acceptés par la Direction Technique. Le CDC (§15.3) exige la fidélité de la pagination avec Word : un modèle qui change de pagination ne doit pas être balisé tel quel.

## Limites connues

- Le script mesure les **fins de page** (les 8 derniers mots de chaque page) et le nombre de pages. Il ne voit pas un décalage purement visuel (couleur, alignement, image déplacée) : garder un coup d'œil sur quelques PDF de chaque famille de modèle.
- Version de LibreOffice : celle de Debian dans l'image (25.2.3.2 au 06/10/2026), pas celle du poste (26.8). Seul le rendu de l'image compte pour le VPS.
- Un modèle protégé par mot de passe, ou qui déclenche une boîte de dialogue dans Word (liaisons, macros), peut faire échouer l'export : il est alors signalé « ECHEC ».
