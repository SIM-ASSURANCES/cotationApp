#!/usr/bin/env bash
# Exporte l'arborescence des documents émis (ou une partie) avec un manifeste CSV, pour un archivage, un audit ou une remise
# (CDC §14.3 : empreinte SHA-256 vérifiable à tout moment).
#
#   scripts/export-archive.sh -p PROJET -d DESTINATION [-s SOUS_DOSSIER]
#
#   -p  projet Docker Compose (« sim-documents » sur le serveur)
#   -d  dossier de destination, chemin absolu : il doit être vide ou ne pas exister (rien n'est jamais écrasé), et ne pas se
#       trouver à l'intérieur des données du projet
#   -s  sous-dossier à exporter, relatif à la racine des documents, ex. SANTE/RELAXSANTE/CLI-12 (défaut : tout)
#
# La destination reçoit :
#   documents/            l'arborescence copiée telle quelle (avec le sous-dossier, s'il y en a un : les chemins restent identiques)
#   MANIFESTE.csv         numero,type,date_emission,chemin,empreinte_sha256 : une ligne par fichier, lue dans la base (documents émis,
#                         rééditions comprises, et archives ZIP des imports en masse « ARCHIVE_IMPORT »)
#   verifier-archive.sh   copie du script de vérification, autonome : ./verifier-archive.sh dans le dossier de l'archive
# Les documents en écriture différée (PDF encore en base, T14) n'ont pas de fichier : ils sont comptés et signalés, pas listés.
# À la fin, l'archive est vérifiée par verifier-archive.sh ; le code de sortie est le sien (0 conforme, 2 écarts).
# Lecture seule sur la pile : le volume est monté en lecture seule, la base n'est interrogée que par SELECT.
set -Eeuo pipefail
umask 077
NOM_SCRIPT=export-archive
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-sauvegarde.sh
. "$REP/lib-sauvegarde.sh"

utilisation="usage : $0 -p PROJET -d DESTINATION [-s SOUS_DOSSIER]"
PROJET=""
DESTINATION=""
SOUS=""
while getopts ":p:d:s:" option; do
  case "$option" in
    p) PROJET="$OPTARG" ;;
    d) DESTINATION="$OPTARG" ;;
    s) SOUS="$OPTARG" ;;
    *) echec "$utilisation" ;;
  esac
done
[ -n "$PROJET" ] && [ -n "$DESTINATION" ] || echec "$utilisation"
exiger_commandes docker sha256sum realpath

# --- Sous-dossier : mêmes règles que le stockage du générateur (stockage.py) --------------------------------------------
if [ -n "$SOUS" ]; then
  SOUS="${SOUS#/}"
  SOUS="${SOUS%/}"
  segments_ok=1
  IFS=/ read -r -a segments <<<"$SOUS"
  [ "${#segments[@]}" -le 10 ] || segments_ok=0
  for segment in "${segments[@]}"; do
    [[ "$segment" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$ ]] || segments_ok=0 # exclut « .. », « . », les vides, les espaces
  done
  [ "$segments_ok" = 1 ] || echec "sous-dossier invalide : « $SOUS » (10 segments au plus, lettres, chiffres, « _ », « - », « . » ; ni « .. » ni chemin absolu)."
fi

# --- Destination ---------------------------------------------------------------------------------------------------------
case "$DESTINATION" in /*) ;; *) echec "la destination doit être un chemin absolu (reçu : $DESTINATION)." ;; esac
DEST="$(realpath -m -- "$DESTINATION")"
[ "$DEST" != "/" ] || echec "la destination ne peut pas être la racine."
refuser_dans_donnees "$PROJET" "$DEST" "la destination"
if [ -e "$DEST" ]; then
  [ -d "$DEST" ] || echec "la destination existe et n'est pas un dossier : $DEST"
  [ -z "$(ls -A "$DEST")" ] || echec "REFUS : la destination n'est pas vide ($DEST) : un export n'écrase jamais rien."
fi

# --- Pile Docker ---------------------------------------------------------------------------------------------------------
PG="$(conteneur_service "$PROJET" postgres)"
[ -n "$PG" ] || echec "aucun conteneur « postgres » en marche pour le projet « $PROJET » (docker compose -p $PROJET ps)."
VOLUME="$(volume_projet "$PROJET" documents)"
[ -n "$VOLUME" ] || echec "volume « documents » introuvable pour le projet « $PROJET »."
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG")"

AIDE=""
CREE_DEST=0
nettoyer() {
  local code=$?
  trap - EXIT
  [ -z "$AIDE" ] || docker rm -f "$AIDE" >/dev/null 2>&1 || true
  if [ "$code" != 0 ] && [ "$code" != 2 ] && [ "$CREE_DEST" = 1 ]; then
    rm -rf -- "$DEST"
    printf '[%s] %s export NON terminé (code %s) : la destination a été retirée.\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$code" >&2
  fi
  exit "$code"
}
trap nettoyer EXIT
trap 'exit 130' INT TERM

# Conteneur jetable qui ne sert qu'à monter le volume en LECTURE SEULE : « docker cp » lit à travers lui.
AIDE="export-aide-$$"
docker create --name "$AIDE" --entrypoint true -v "$VOLUME:/donnees:ro" "$IMAGE" >/dev/null
RACINE_DOCS="/donnees/sortie/documents"
SOURCE="$RACINE_DOCS${SOUS:+/$SOUS}"
# Le dossier existe-t-il ? (message plus clair qu'une erreur de « docker cp »)
if ! docker run --rm --entrypoint test -v "$VOLUME:/donnees:ro" "$IMAGE" -d "$SOURCE"; then
  if [ -n "$SOUS" ]; then echec "sous-dossier introuvable dans les documents : $SOUS"; else echec "aucun document dans le volume « $VOLUME »."; fi
fi

mkdir -p "$DEST"
CREE_DEST=1

# --- Manifeste : lu dans la base AVANT la copie (les documents ne font que s'ajouter) --------------------------------------
FILTRE_DOC=""
FILTRE_LOT=""
if [ -n "$SOUS" ]; then
  # SOUS ne contient que [A-Za-z0-9_.-/] (validé plus haut) : sans danger dans un littéral SQL. « left(...) = SOUS/ » plutôt que LIKE,
  # où « _ » est un joker.
  FILTRE_DOC="and left(d.chemin, ${#SOUS} + 1) = '$SOUS/'"
  FILTRE_LOT="and left(l.zip_chemin, ${#SOUS} + 1) = '$SOUS/'"
fi
REQUETE="copy (
  select d.numero, d.type, to_char(d.date_emission, 'YYYY-MM-DD') as date_emission, d.chemin, d.empreinte as empreinte_sha256
    from documents_emis d
   where not exists (select 1 from ecritures_differees e where e.document_id = d.id) $FILTRE_DOC
  union all
  select 'LOT-' || l.id, 'ARCHIVE_IMPORT', to_char(l.cree_le::date, 'YYYY-MM-DD'), l.zip_chemin, l.zip_empreinte
    from lots_import l
   where l.zip_chemin is not null $FILTRE_LOT
  order by 4
) to stdout with csv header"
docker exec "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -c "$1"' _ "$REQUETE" >"$DEST/MANIFESTE.csv" \
  || echec "lecture du manifeste dans la base impossible."
LIGNES=$(($(wc -l <"$DEST/MANIFESTE.csv") - 1))
DIFFERES="$(sql "$PG" "select count(*) from ecritures_differees e join documents_emis d on d.id = e.document_id where true ${FILTRE_DOC}")"
[ "$DIFFERES" = 0 ] || avertir "$DIFFERES document(s) en écriture différée (PDF encore en base, pas encore dans le volume) : non listés, à relancer plus tard."
journal "manifeste : $LIGNES fichier(s) cité(s) par la base${SOUS:+ sous $SOUS}"

# --- Copie ---------------------------------------------------------------------------------------------------------------
mkdir -p "$DEST/documents${SOUS:+/$SOUS}"
docker cp "$AIDE:$SOURCE/." "$(chemin_hote "$DEST/documents${SOUS:+/$SOUS}")"
docker rm -f "$AIDE" >/dev/null
AIDE=""
cp -- "$REP/verifier-archive.sh" "$DEST/verifier-archive.sh"
chmod u+x "$DEST/verifier-archive.sh"
journal "arborescence copiée dans $DEST/documents ($(find "$DEST/documents" -type f | wc -l | tr -d ' ') fichier(s))"

# --- Vérification de l'archive produite ------------------------------------------------------------------------------------
journal "vérification de l'archive..."
bash "$DEST/verifier-archive.sh" -a "$DEST"
