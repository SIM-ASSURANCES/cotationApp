#!/usr/bin/env bash
# Sauvegarde de la base PostgreSQL et du volume des documents émis (CDC §14.3, étape 8, docs/deploiement.md §7).
#
#   DOSSIER_SAUVEGARDE=/chemin/absolu  scripts/sauvegarde.sh -p PROJET -t quotidienne|hebdomadaire
#
#   -p  nom du projet Docker Compose (« sim-documents » sur le serveur ; « sauvegarde-test » pour un essai sur une pile jetable)
#   -t  type de la sauvegarde : il fixe la durée de conservation (7 quotidiennes, 8 hebdomadaires, rotation-sauvegardes.sh)
#
#   DOSSIER_SAUVEGARDE (OBLIGATOIRE) : dossier existant où les sauvegardes sont écrites (disque ou serveur distinct, à fixer
#   par le superviseur). Le script refuse de tourner si la variable est vide ou si le dossier est à l'intérieur d'un volume de
#   données du projet : une sauvegarde qui vit avec les données ne les protège pas. Le dossier n'est jamais créé par le script
#   (un disque non monté ne doit pas être remplacé en silence par un dossier du disque local).
#   TABLES_CLES : tables dont le nombre de lignes est noté dans le manifeste (défaut : voir lib-sauvegarde.sh).
#
# Une sauvegarde = un dossier « AAAAMMJJ-HHMMSS_<type> » : base.dump (pg_dump -Fc), documents.tgz, MANIFESTE.txt, SHA256SUMS.
# Elle est écrite dans un dossier provisoire puis renommée : une sauvegarde incomplète n'apparaît jamais dans la liste.
# Les fichiers sont produits DANS les conteneurs puis récupérés par « docker cp » (jamais de redirection de flux binaire).
set -Eeuo pipefail
umask 077
NOM_SCRIPT=sauvegarde
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-sauvegarde.sh
. "$REP/lib-sauvegarde.sh"

utilisation="usage : DOSSIER_SAUVEGARDE=/chemin $0 -p PROJET -t quotidienne|hebdomadaire"
PROJET=""
TYPE=""
while getopts ":p:t:" option; do
  case "$option" in
    p) PROJET="$OPTARG" ;;
    t) TYPE="$OPTARG" ;;
    *) echec "$utilisation" ;;
  esac
done
[ -n "$PROJET" ] && [ -n "$TYPE" ] || echec "$utilisation"
case "$TYPE" in quotidienne | hebdomadaire) ;; *) echec "type inconnu : « $TYPE » (quotidienne ou hebdomadaire)" ;; esac

# --- Dossier cible -------------------------------------------------------------------------------------------------------
[ -n "${DOSSIER_SAUVEGARDE:-}" ] || echec "DOSSIER_SAUVEGARDE est vide : fixer le dossier cible des sauvegardes (obligatoire)."
case "$DOSSIER_SAUVEGARDE" in /*) ;; *) echec "DOSSIER_SAUVEGARDE doit être un chemin absolu (reçu : $DOSSIER_SAUVEGARDE)." ;; esac
exiger_commandes docker sha256sum gzip realpath date
DOSSIER="$(realpath -m -- "$DOSSIER_SAUVEGARDE")"
[ "$DOSSIER" != "/" ] || echec "DOSSIER_SAUVEGARDE ne peut pas être la racine."

refuser_dans_donnees "$PROJET" "$DOSSIER" DOSSIER_SAUVEGARDE

[ -d "$DOSSIER" ] || echec "DOSSIER_SAUVEGARDE n'existe pas : $DOSSIER (le script ne le crée pas ; disque monté ?)."
[ -w "$DOSSIER" ] || echec "DOSSIER_SAUVEGARDE n'est pas accessible en écriture : $DOSSIER."

# --- Pile Docker ---------------------------------------------------------------------------------------------------------
PG="$(conteneur_service "$PROJET" postgres)"
[ -n "$PG" ] || echec "aucun conteneur « postgres » en marche pour le projet « $PROJET » (docker compose -p $PROJET ps)."
VOLUME="$(volume_projet "$PROJET" documents)"
[ -n "$VOLUME" ] || echec "volume « documents » introuvable pour le projet « $PROJET »."
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG")" # image déjà présente sur l'hôte : sert aussi à l'archivage, rien à télécharger
TABLES_CLES="${TABLES_CLES:-$TABLES_CLES_DEFAUT}"
# shellcheck disable=SC2086 # liste de mots voulue
valider_tables $TABLES_CLES

# --- Verrou et nettoyage -------------------------------------------------------------------------------------------------
TMP=""
AIDE=""
DUMP_CONTENEUR=""
VERROU="$DOSSIER/.verrou"
POSSEDE_VERROU=0
SAUVEGARDE_FAITE=0
nettoyer() {
  local code=$?
  trap - EXIT
  [ -z "$AIDE" ] || docker rm -f "$AIDE" >/dev/null 2>&1 || true
  [ -z "$DUMP_CONTENEUR" ] || docker exec "$PG" rm -f "$DUMP_CONTENEUR" >/dev/null 2>&1 || true
  [ -z "$TMP" ] || rm -rf -- "$TMP"
  [ "$POSSEDE_VERROU" = 0 ] || rm -rf -- "$VERROU"
  [ "$code" = 0 ] || printf '[%s] %s sauvegarde NON terminée (code %s) : rien n'"'"'a été ajouté au dossier.\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$code" >&2
  exit "$code"
}
trap nettoyer EXIT
trap 'exit 130' INT TERM

if ! mkdir "$VERROU" 2>/dev/null; then
  pid_verrou="$(cat "$VERROU/pid" 2>/dev/null || true)"
  if [ -n "$pid_verrou" ] && ! kill -0 "$pid_verrou" 2>/dev/null; then
    avertir "verrou abandonné par un processus disparu (pid $pid_verrou) : repris."
    rm -rf -- "$VERROU"
    mkdir "$VERROU" || echec "impossible de prendre le verrou $VERROU."
  else
    echec "une autre sauvegarde est en cours (verrou $VERROU, pid ${pid_verrou:-inconnu}). Si ce n'est pas le cas, supprimer ce dossier."
  fi
fi
POSSEDE_VERROU=1
printf '%s\n' "$$" >"$VERROU/pid"
# Sous le verrou, tout « .en-cours-* » est le reste d'une sauvegarde interrompue.
for reste in "$DOSSIER"/.en-cours-*; do
  if [ -e "$reste" ]; then
    avertir "reste d'une sauvegarde interrompue supprimé : $reste"
    rm -rf -- "$reste"
  fi
done

DATE_NOM="$(date +%Y%m%d-%H%M%S)"
NOM="${DATE_NOM}_${TYPE}"
[ ! -e "$DOSSIER/$NOM" ] || echec "la sauvegarde $NOM existe déjà."
TMP="$DOSSIER/.en-cours-$$"
mkdir "$TMP"
journal "début : projet $PROJET, type $TYPE, vers $DOSSIER/$NOM"

# --- Nombre de lignes avant ----------------------------------------------------------------------------------------------
declare -A avant=() apres=()
compter() { sql "$PG" "select count(*) from \"$1\"" || echec "impossible de compter les lignes de la table « $1 »."; }
# shellcheck disable=SC2086
for t in $TABLES_CLES _prisma_migrations; do avant[$t]="$(compter "$t")"; done

# --- Base : pg_dump -Fc écrit DANS le conteneur, puis docker cp -----------------------------------------------------------
DUMP_CONTENEUR="/tmp/sauvegarde-$$.dump"
docker exec "$PG" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -f "$1" "$POSTGRES_DB"' _ "$DUMP_CONTENEUR"
docker exec "$PG" pg_restore -l "$DUMP_CONTENEUR" >/dev/null || echec "le fichier produit par pg_dump n'est pas lisible par pg_restore."
empreinte_dump_conteneur="$(docker exec "$PG" sha256sum "$DUMP_CONTENEUR" | cut -d' ' -f1)"
docker cp "$PG:$DUMP_CONTENEUR" "$(chemin_hote "$TMP/base.dump")"
empreinte_dump="$(sha256sum "$TMP/base.dump" | cut -d' ' -f1)"
[ "$empreinte_dump" = "$empreinte_dump_conteneur" ] || echec "base.dump copié différent de celui du conteneur (empreintes)."
journal "base sauvegardée ($(wc -c <"$TMP/base.dump") octets)"

# --- Nombre de lignes après (la base a pu changer pendant la sauvegarde : le contrôle accepte l'intervalle) -----------------
# shellcheck disable=SC2086
for t in $TABLES_CLES _prisma_migrations; do apres[$t]="$(compter "$t")"; done

# --- Documents : archive faite dans un conteneur jetable, volume monté en lecture seule -----------------------------------
SCRIPT_ARCHIVE="$(
  cat <<'FIN'
tar czf /tmp/documents.tgz -C /donnees --exclude=./profil-libreoffice .
code=$?
if [ "$code" -gt 1 ]; then exit "$code"; fi
[ "$code" -eq 0 ] || echo "AVERTISSEMENT : des fichiers ont changé pendant l'archivage (tar code 1)." >&2
gzip -t /tmp/documents.tgz
sha256sum /tmp/documents.tgz | cut -d' ' -f1 >/tmp/documents.sha256
FIN
)"
AIDE="sauvegarde-aide-$$"
docker create --name "$AIDE" --entrypoint sh -v "$VOLUME:/donnees:ro" "$IMAGE" -c "$SCRIPT_ARCHIVE" >/dev/null
docker start -a "$AIDE" >/dev/null
docker cp "$AIDE:/tmp/documents.tgz" "$(chemin_hote "$TMP/documents.tgz")"
docker cp "$AIDE:/tmp/documents.sha256" "$(chemin_hote "$TMP/.documents.sha256")"
empreinte_archive_conteneur="$(tr -d '[:space:]' <"$TMP/.documents.sha256")"
rm -f "$TMP/.documents.sha256"
docker rm -f "$AIDE" >/dev/null
AIDE=""
empreinte_archive="$(sha256sum "$TMP/documents.tgz" | cut -d' ' -f1)"
[ "$empreinte_archive" = "$empreinte_archive_conteneur" ] || echec "documents.tgz copié différent de celui du conteneur (empreintes)."
gzip -t "$TMP/documents.tgz" || echec "documents.tgz est illisible."
journal "documents archivés ($(wc -c <"$TMP/documents.tgz") octets)"

# --- Manifeste et empreintes ---------------------------------------------------------------------------------------------
{
  echo "FORMAT=1"
  echo "PROJET=$PROJET"
  echo "TYPE=$TYPE"
  echo "DATE=$(date -Iseconds)"
  echo "BASE=$(docker exec "$PG" sh -c 'printf %s "$POSTGRES_DB"')"
  echo "POSTGRES=$(docker exec "$PG" postgres --version)"
  echo "MIGRATIONS=${apres[_prisma_migrations]}"
  # shellcheck disable=SC2086
  for t in $TABLES_CLES _prisma_migrations; do echo "COMPTE $t ${avant[$t]} ${apres[$t]}"; done
} >"$TMP/MANIFESTE.txt"
(cd "$TMP" && sha256sum base.dump documents.tgz MANIFESTE.txt >SHA256SUMS && sha256sum -c --quiet SHA256SUMS)

# --- Mise en place atomique, puis rotation ---------------------------------------------------------------------------------
mv -- "$TMP" "$DOSSIER/$NOM"
TMP=""
SAUVEGARDE_FAITE=1
journal "terminé : $DOSSIER/$NOM ($(du -sh "$DOSSIER/$NOM" | cut -f1))"

if ! bash "$REP/rotation-sauvegardes.sh" -d "$DOSSIER"; then
  CODE_ECHEC=5 echec "la sauvegarde est faite, mais la rotation (suppression des anciennes) a échoué."
fi
