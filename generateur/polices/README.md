# Polices des modèles Word

**D69 : aucune police Microsoft n'est nécessaire pour Calibri, Arial ni Times New Roman.** L'image Docker du générateur installe des polices **libres de mêmes dimensions de caractères**, que fontconfig (donc LibreOffice) utilise à leur place : les retours à la ligne, donc les sauts de page, sont ceux de Word.

Ce dossier est **facultatif**. Il est copié dans l'image (`/usr/local/share/fonts/sim/`). Son contenu est **ignoré par Git** (des polices sous licence y seraient déposées par SIM) : seul ce README est versionné. Vide, l'image fonctionne avec les polices libres ci-dessous.

## Ce que l'image apporte sans rien déposer

| Police des modèles | Police libre de l'image (mêmes dimensions) | Paquet Debian |
| --- | --- | --- |
| Calibri | **Carlito** | `fonts-crosextra-carlito` |
| Arial | **Liberation Sans** | `fonts-liberation` |
| Times New Roman | **Liberation Serif** | `fonts-liberation` |
| Tahoma | *aucune adoptée* (voir ci-dessous) | — |

Les remplaçants autorisés sont listés **à un seul endroit** : `REMPLACANTS_AUTORISES` dans `generateur/app/polices.py`. `/sante` et le vérificateur de modèle (`scripts/verifier_modele.py`) l'utilisent tous deux. Une police sans remplaçant dans cette table (Aptos, Segoe UI…) est remplacée par une police de secours **aux dimensions différentes** (DejaVu…) : les sauts de page peuvent se décaler.

## Tahoma : à déposer ici

Tahoma n'a pas de remplaçant libre **adopté**. Déposer ses deux fichiers :

| Fichier | Police |
| --- | --- |
| `tahoma.ttf` | Tahoma |
| `tahomabd.ttf` | Tahoma Bold |

Sous Windows : `C:\Windows\Fonts\`. Les copier sur un serveur peut ne pas être permis par la licence de la police : tant que le superviseur n'a pas répondu à la question Q2, ne pas déployer ces fichiers sur le VPS. Segoe UI Symbol et Symbol n'ont pas de remplaçant libre adopté : ne les déposer que si l'inventaire des modèles les utilise (le vérificateur de modèle le dit). Montserrat (charte) est à ajouter si des modèles l'utilisent (licence libre).

### Essai de la Tahoma libre de Wine (`TAHOMA_LIBRE`)

La police de remplacement du projet Wine (paquet Debian `fonts-wine`, licence **LGPL-2.1+**, basée sur Bitstream Vera Sans) peut remplacer Tahoma. **Elle n'est pas adoptée** : la mesure du 06/10/2026 ([recette.md](../../docs/recette.md) §1.2, variante C′) avait trouvé que sa pagination s'écartait de Word. L'essai se fait ainsi :

1. Dans `.env` : `TAHOMA_LIBRE=oui`, puis `docker compose build generateur` et `docker compose up -d generateur`. L'image expose alors les deux fichiers Tahoma de Wine sous le nom de famille **« Wine Tahoma »** (`generateur/fontconfig/tahoma-wine.conf`), **uniquement comme solution de repli** : une vraie Tahoma déposée ici garde la priorité.
2. Passer le **test de fidélité** de la CP SECURPRO et de la facture contre leur PDF exporté par Word (voir `docs/recette.md` §1.2 et `scripts/test_fidelite.py`) : mêmes fins de page, polices du PDF lues avec `pdffonts`.
3. Si le test est bon : adopter l'essai en passant `ARG TAHOMA_LIBRE=non` à `oui` dans `generateur/Dockerfile` (et le défaut `${TAHOMA_LIBRE:-non}` de `docker-compose.yml`). Sinon, laisser `non` : Tahoma reste fournie ici.

## Vérifier ce que contient l'image

Pendant `docker compose build`, l'étape `fc-list` affiche les familles installées **et** ce que fontconfig retient pour Tahoma, Calibri, Arial et Times New Roman. Dans un conteneur, ou sur toute machine Linux :

```bash
fc-match -f '%{family} -> %{file}\n' Tahoma      # votre Tahoma, ou « Wine Tahoma » à l'essai ; un repli (DejaVu…) = Tahoma manque
fc-match -f '%{family} -> %{file}\n' Calibri     # Carlito
```

`fc-match` renvoie **toujours** une police : un repli sur DejaVu n'est **pas** une preuve. `GET /sante` du générateur ne l'accepte que si la police est installée ou résolue vers son remplaçant autorisé ; sinon il se déclare « dégradé » (`"polices_manquantes": ["Tahoma"]`) et l'application affiche `generateur: "ko"`. Si une vraie Tahoma est déposée ici **et** que l'essai est actif, `fc-match` dit laquelle est retenue (la vraie).

Au dépôt d'un modèle, une police qu'il utilise et qui n'est ni installée ni couverte par un remplaçant autorisé fait l'objet d'un avertissement. Le test de fidélité `generateur/scripts/test_fidelite.py` détecte tout décalage de pagination et liste les polices du PDF.
