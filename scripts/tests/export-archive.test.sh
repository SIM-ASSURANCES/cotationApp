#!/usr/bin/env bash
# Essai de l'export d'archive et de sa vérification sur une pile Docker JETABLE (projet « export-test », supprimé à la fin) :
#   données inventées -> export complet puis d'un sous-dossier -> vérification -> altérations détectées une à une.
#
#   bash scripts/tests/export-archive.test.sh
set -Eeuo pipefail
PROJET="export-test"
# shellcheck source=lib-pile-test.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-pile-test.sh" # pile jetable, secrets aléatoires, nettoyage à la sortie, fonctions d'essai

EXPORT="$SCRIPTS/export-archive.sh"
SOUS="ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001"
fichiers() { find "$1/documents" -type f | wc -l | tr -d ' '; }
lignes_manifeste() { printf '%s' "$(($(wc -l <"$1/MANIFESTE.csv") - 1))"; }
# sortie_verif <archive> : sortie du script de vérification AUTONOME, lancé depuis l'archive, avec son code de sortie en dernière ligne.
sortie_verif() { (cd "$1" && ./verifier-archive.sh 2>&1; echo "code=$?") || true; }

etape "1. Pile jetable « $PROJET » : migrations, données inventées, fichiers (3 PDF et 1 archive ZIP d'import)"
preparer_pile_avec_donnees
read -r chemin_contrat empreinte_contrat _ <<<"$(printf '%s\n' "$PDF_EMPREINTES" | sed -n 2p)"
read -r chemin_zip empreinte_zip _ <<<"$ZIP_EMPREINTES"
verifier "3 documents émis, 4 fichiers dans le volume" "3 4" "${attendu[documents_emis]} $(docker exec "$GEN" sh -c 'find /donnees/sortie/documents -type f | wc -l | tr -d " "')"

# ---------------------------------------------------------------------------------------------------------------------
etape "2. Refus (rien n'est créé)"
REFUSE="$TMP/refuse"
refus "projet sans pile" "aucun conteneur" bash "$EXPORT" -p "$PROJET-inexistant" -d "$REFUSE"
refus "destination absente de la commande" "usage" bash "$EXPORT" -p "$PROJET"
refus "destination relative" "chemin absolu" bash "$EXPORT" -p "$PROJET" -d "export"
refus "destination dans le volume des documents" "à l'intérieur des données du projet" \
  bash "$EXPORT" -p "$PROJET" -d "/var/lib/docker/volumes/${PROJET}_documents/_data/export"
mkdir -p "$TMP/plein" && : >"$TMP/plein/existant.txt"
refus "destination non vide : jamais d'écrasement" "REFUS : la destination n'est pas vide" bash "$EXPORT" -p "$PROJET" -d "$TMP/plein"
refus "sous-dossier avec « .. »" "sous-dossier invalide" bash "$EXPORT" -p "$PROJET" -d "$REFUSE" -s "ESSAI_PRINCIPALE/../.."
refus "sous-dossier avec une espace" "sous-dossier invalide" bash "$EXPORT" -p "$PROJET" -d "$REFUSE" -s "ESSAI PRINCIPALE"
refus "sous-dossier de plus de 10 segments" "sous-dossier invalide" bash "$EXPORT" -p "$PROJET" -d "$REFUSE" -s "a/b/c/d/e/f/g/h/i/j/k"
refus "sous-dossier inexistant" "sous-dossier introuvable" bash "$EXPORT" -p "$PROJET" -d "$REFUSE" -s "ESSAI_PRINCIPALE/ESSAIPROD/CLI-9"
refus "début de segment (« POL-2026-90000 » n'est pas « POL-2026-900001 »)" "sous-dossier introuvable" bash "$EXPORT" -p "$PROJET" -d "$REFUSE" -s "${SOUS%?}"
verifier "aucune destination créée par les refus" "absent" "$([ -e "$REFUSE" ] && echo présent || echo absent)"
verifier "la destination non vide est intacte" "existant.txt" "$(ls -A "$TMP/plein")"

# ---------------------------------------------------------------------------------------------------------------------
etape "3. Export complet"
COMPLET="$TMP/complet"
sortie="$(bash "$EXPORT" -p "$PROJET" -d "$COMPLET" 2>&1)" && code=0 || code=$?
printf '%s\n' "$sortie" | sed 's/^/    | /'
verifier "code de sortie 0 (archive vérifiée conforme)" "0" "$code"
verifier "contenu : documents/, MANIFESTE.csv, verifier-archive.sh" "MANIFESTE.csv documents verifier-archive.sh" "$(ls -1 "$COMPLET" | tr '\n' ' ' | sed 's/ $//')"
verifier "en-tête du manifeste" "numero,type,date_emission,chemin,empreinte_sha256" "$(head -n 1 "$COMPLET/MANIFESTE.csv" | tr -d '\r')"
verifier "4 lignes au manifeste, 4 fichiers copiés" "4 4" "$(lignes_manifeste "$COMPLET") $(fichiers "$COMPLET")"
verifier "ligne d'un document : numéro, type, date, chemin, empreinte" "COT-ESSAI-2,COTATION,2026-10-22,$chemin_contrat,$empreinte_contrat" \
  "$(grep ",$chemin_contrat," "$COMPLET/MANIFESTE.csv" | tr -d '\r')"
case "$(grep ",$chemin_zip," "$COMPLET/MANIFESTE.csv" | tr -d '\r')" in
  "LOT-1,ARCHIVE_IMPORT,"*",$chemin_zip,$empreinte_zip") ok "ligne de l'archive ZIP d'un import (ARCHIVE_IMPORT)" ;;
  *) ko "ligne de l'archive ZIP d'un import absente ou fausse" ;;
esac
verifier "contenu du fichier copié identique à celui du volume" "$empreinte_contrat" "$(sha256sum "$COMPLET/documents/$chemin_contrat" | cut -d' ' -f1)"
verifier "vérification autonome depuis l'archive (sans Docker)" "code=0" "$(sortie_verif "$COMPLET" | tail -n 1)"
for t in $TABLES; do verifier "$t : base inchangée par l'export" "${attendu[$t]}" "$(compte "$t")"; done
verifier "volume inchangé par l'export (4 fichiers)" "4" "$(docker exec "$GEN" sh -c 'find /donnees/sortie/documents -type f | wc -l | tr -d " "')"

# ---------------------------------------------------------------------------------------------------------------------
etape "4. Export d'un sous-dossier (avec « / » final : normalisé)"
PARTIEL="$TMP/partiel"
sortie="$(bash "$EXPORT" -p "$PROJET" -d "$PARTIEL" -s "$SOUS/" 2>&1)" && code=0 || code=$?
printf '%s\n' "$sortie" | sed 's/^/    | /'
verifier "code de sortie 0" "0" "$code"
verifier "3 lignes au manifeste (contrat, facture, ZIP), 3 fichiers" "3 3" "$(lignes_manifeste "$PARTIEL") $(fichiers "$PARTIEL")"
verifier "la cotation, hors du sous-dossier, n'est ni listée ni copiée" "0 0" \
  "$(grep -c "cotation-1.pdf" "$PARTIEL/MANIFESTE.csv" || true) $(find "$PARTIEL/documents" -name 'cotation-1.pdf' | wc -l | tr -d ' ')"
verifier "les chemins restent ceux de la base (le sous-dossier est conservé)" "présent" "$([ -f "$PARTIEL/documents/$chemin_contrat" ] && echo présent || echo absent)"
verifier "vérification autonome" "code=0" "$(sortie_verif "$PARTIEL" | tail -n 1)"

# ---------------------------------------------------------------------------------------------------------------------
etape "5. La vérification signale chaque écart"
ALTEREE="$TMP/alteree"
cp -r "$COMPLET" "$ALTEREE"
chemin_facture="$(printf '%s\n' "$PDF_EMPREINTES" | sed -n 3p | cut -d' ' -f1)"
chmod u+w "$ALTEREE/documents/$chemin_contrat" && printf 'x' >>"$ALTEREE/documents/$chemin_contrat"   # modifié
rm -f "$ALTEREE/documents/$chemin_facture"                                                            # disparu
printf 'intrus' >"$ALTEREE/documents/intrus.txt"                                                      # en trop
printf 'LOT-9,ARCHIVE_IMPORT,2026-10-22,../hors/archive.zip,%s\n' "$empreinte_zip" >>"$ALTEREE/MANIFESTE.csv"   # chemin non conforme
doublon="$(grep ",$chemin_zip," "$ALTEREE/MANIFESTE.csv")"
printf '%s
' "$doublon" >>"$ALTEREE/MANIFESTE.csv"                                                  # doublon
sortie="$(sortie_verif "$ALTEREE")"
printf '%s\n' "$sortie" | sed 's/^/    | /'
for motif in "EMPREINTE DIFFÉRENTE  $chemin_contrat" "FICHIER ABSENT  $chemin_facture" "NON LISTÉ  intrus.txt" "LIGNE INVALIDE  ligne" "DOUBLON  $chemin_zip"; do
  case "$sortie" in *"$motif"*) ok "signalé : ${motif:0:24}..." ;; *) ko "écart non signalé : $motif" ;; esac
done
case "$sortie" in *"ARCHIVE NON CONFORME : 5 écart(s)"*) ok "récapitulatif : 5 écarts" ;; *) ko "le récapitulatif devait annoncer 5 écarts" ;; esac
case "$sortie" in *"code=2") ok "code de sortie 2" ;; *) ko "code de sortie 2 attendu" ;; esac

# Une empreinte falsifiée dans le manifeste, seule.
FALSIFIEE="$TMP/falsifiee"
cp -r "$COMPLET" "$FALSIFIEE"
sed -i "s/$empreinte_zip/$(printf '0%.0s' $(seq 1 64))/" "$FALSIFIEE/MANIFESTE.csv"
sortie="$(sortie_verif "$FALSIFIEE")"
case "$sortie" in *"EMPREINTE DIFFÉRENTE  $chemin_zip"*"1 écart(s)"*"code=2") ok "empreinte falsifiée au manifeste : détectée" ;; *) ko "empreinte falsifiée non détectée : $sortie" ;; esac

# Archive inutilisable : erreur d'utilisation (code 1), pas un faux « conforme ».
SANS_MANIFESTE="$TMP/sans-manifeste"
cp -r "$COMPLET" "$SANS_MANIFESTE" && rm "$SANS_MANIFESTE/MANIFESTE.csv"
case "$(sortie_verif "$SANS_MANIFESTE")" in *"MANIFESTE.csv introuvable"*"code=1") ok "manifeste absent : erreur, code 1" ;; *) ko "manifeste absent : erreur attendue" ;; esac

echo
if [ "$echecs" = 0 ]; then
  echo "Export d'archive : tous les contrôles passent. La pile « $PROJET » va être supprimée."
else
  echo "Export d'archive : $echecs contrôle(s) en échec."
  exit 1
fi
