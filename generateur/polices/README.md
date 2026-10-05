# Polices des modèles Word

Ce dossier est copié dans l'image Docker du générateur (`/usr/local/share/fonts/sim/`). Son contenu est **ignoré par Git** (les polices Microsoft sont sous licence) : seul ce README est versionné.

## À y déposer

Les fichiers `.ttf` / `.otf` des polices **réellement utilisées** par les modèles Word et qui n'ont pas d'équivalent libre dans l'image :

| Police | Dans l'image sans fichier de ta part ? | À déposer |
| --- | --- | --- |
| Calibri | oui, remplacée par **Carlito** (mêmes dimensions de caractères) | optionnel (rendu identique à Word) |
| Arial, Times New Roman | oui, remplacées par **Liberation** (mêmes dimensions) | optionnel |
| **Tahoma**, Tahoma Bold | **non** | `tahoma.ttf`, `tahomabd.ttf` |
| Segoe UI Symbol, Symbol | **non** | selon l'inventaire |
| Montserrat (charte) | non | à ajouter si des modèles l'utilisent (licence libre) |

Les noms de fichiers sous Windows : `C:\Windows\Fonts\` (Tahoma : `tahoma.ttf`, `tahomabd.ttf`).

## Pourquoi c'est important

Si une police manque, LibreOffice en prend une autre de largeur différente : les retours à la ligne changent, donc les **sauts de page se décalent** (CDC §15.3, fidélité). Le test `generateur/scripts/test_fidelite.py` détecte ce décalage et liste les polices du PDF.

## Licence (question Q2 au superviseur)

Copier les fichiers de polices d'un poste Windows sous licence vers un serveur peut ne pas être permis par la licence Microsoft. Tant que le superviseur n'a pas répondu à la question Q2, ne pas déployer ces fichiers sur le VPS ; en cas de refus, les polices de substitution libres sont à valider avec la Direction Technique.

## Vérifier ce que contient l'image

Pendant `docker compose build`, la liste des familles installées est affichée (étape `fc-list`).
