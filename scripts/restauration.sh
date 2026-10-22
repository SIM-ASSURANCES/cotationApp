#!/usr/bin/env bash
# Restauration d'une sauvegarde (scripts/sauvegarde.sh) dans une pile NEUVE, puis vérification (étape 8, docs/deploiement.md §7).
#
#   scripts/restauration.sh -p PROJET -s DOSSIER_DE_LA_SAUVEGARDE
#
#   -p  projet Docker Compose de la pile NEUVE : ses services « postgres » et « generateur » sont démarrés
#       (docker compose -p PROJET up -d postgres generateur), sa base est vide et son volume « documents » aussi.
#   -s  dossier d'une sauvegarde (« AAAAMMJJ-HHMMSS_<type> », celui qui contient base.dump et documents.tgz)
#
# Garde-fous : la restauration REFUSE, avant de rien écrire, une base de destination qui contient déjà quelque chose
# (une table, une séquence, une vue) ou un volume « documents » qui contient déjà un fichier. Elle ne touche donc jamais la
# base en service ; pour restaurer, on part d'une pile neuve (ou d'une base et d'un volume vidés À LA MAIN, en connaissance de cause).
# Ordre : contrôle des empreintes de la sauvegarde -> contrôle des destinations -> pg_restore (une seule transaction : en cas
# d'erreur la base reste vide) -> extraction des documents -> vérifications.
# Les vérifications : migrations (prisma migrate status), nombre de lignes des tables clés comparé au manifeste, fichiers cités par
# la base présents dans le volume, ouverture d'un PDF (empreinte conforme, pypdf) par le conteneur du générateur.
#
#   ENV_FILE   fichier d'environnement de docker-compose (défaut : .env à la racine du dépôt), pour `docker compose run outils`.
#
# Codes de sortie : 0 tout est conforme ; 1 erreur ou refus ; 4 restauration faite mais une vérification a échoué.
set -Eeuo pipefail
umask 077
NOM_SCRIPT=restauration
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "$REP/.." && pwd)"
# shellcheck source=lib-sauvegarde.sh
. "$REP/lib-sauvegarde.sh"

utilisation="usage : $0 -p PROJET -s DOSSIER_DE_LA_SAUVEGARDE"
PROJET=""
JEU=""
while getopts ":p:s:" option; do
  case "$option" in
    p) PROJET="$OPTARG" ;;
    s) JEU="$OPTARG" ;;
    *) echec "$utilisation" ;;
  esac
done
[ -n "$PROJET" ] && [ -n "$JEU" ] || echec "$utilisation"
exiger_commandes docker sha256sum gzip realpath

# --- La sauvegarde -------------------------------------------------------------------------------------------------------
JEU="$(realpath -m -- "$JEU")"
for f in base.dump documents.tgz MANIFESTE.txt SHA256SUMS; do
  [ -f "$JEU/$f" ] || echec "sauvegarde incomplète : $JEU/$f est absent."
done
(cd "$JEU" && sha256sum -c --quiet SHA256SUMS) || echec "les empreintes de la sauvegarde ne correspondent pas (fichier abîmé ou modifié) : $JEU"
journal "sauvegarde $(basename "$JEU") : empreintes conformes"

declare -A compte_min=() compte_max=()
tables_a_comparer=()
while read -r mot table avant apres; do
  [ "$mot" = COMPTE ] || continue
  tables_a_comparer+=("$table")
  if [ "$avant" -le "$apres" ]; then compte_min[$table]=$avant compte_max[$table]=$apres; else compte_min[$table]=$apres compte_max[$table]=$avant; fi
done <"$JEU/MANIFESTE.txt"
[ "${#tables_a_comparer[@]}" -gt 0 ] || echec "le manifeste ne contient aucun comptage de lignes : $JEU/MANIFESTE.txt"
valider_tables "${tables_a_comparer[@]}"

# --- La pile de destination ----------------------------------------------------------------------------------------------
PG="$(conteneur_service "$PROJET" postgres)"
[ -n "$PG" ] || echec "aucun conteneur « postgres » en marche pour le projet « $PROJET » : docker compose -p $PROJET up -d postgres generateur"
GEN="$(conteneur_service "$PROJET" generateur)"
[ -n "$GEN" ] || echec "aucun conteneur « generateur » en marche pour le projet « $PROJET » : docker compose -p $PROJET up -d postgres generateur"
VOLUME="$(volume_projet "$PROJET" documents)"
[ -n "$VOLUME" ] || echec "volume « documents » introuvable pour le projet « $PROJET »."
attendre_postgres "$PG" || echec "PostgreSQL ne répond pas (docker compose -p $PROJET logs postgres)."
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG")"
NOM_BASE="$(docker exec "$PG" sh -c 'printf %s "$POSTGRES_DB"')"

# 1. La base de destination doit être vide.
objets="$(sql "$PG" "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg_temp%' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')")" \
  || echec "impossible de lire la base de destination."
[ "$objets" = 0 ] || echec "REFUS : la base « $NOM_BASE » du projet « $PROJET » n'est pas vide ($objets objet(s)). La restauration ne s'applique qu'à une base neuve ; elle ne touche jamais une base en service."

# 2. Le volume des documents doit être vide.
fichiers="$(docker run --rm --entrypoint sh -v "$VOLUME:/donnees:ro" "$IMAGE" -c 'find /donnees/sortie -type f 2>/dev/null | head -n 1')"
[ -z "$fichiers" ] || echec "REFUS : le volume « $VOLUME » contient déjà des documents (par exemple $fichiers). La restauration ne s'applique qu'à un volume neuf."

# --- Nettoyage -----------------------------------------------------------------------------------------------------------
AIDE=""
DUMP_CONTENEUR=""
nettoyer() {
  local code=$?
  trap - EXIT
  [ -z "$AIDE" ] || docker rm -f "$AIDE" >/dev/null 2>&1 || true
  [ -z "$DUMP_CONTENEUR" ] || docker exec "$PG" rm -f "$DUMP_CONTENEUR" >/dev/null 2>&1 || true
  exit "$code"
}
trap nettoyer EXIT
trap 'exit 130' INT TERM

# --- Base ----------------------------------------------------------------------------------------------------------------
DUMP_CONTENEUR="/tmp/restauration-$$.dump"
docker cp "$(chemin_hote "$JEU/base.dump")" "$PG:$DUMP_CONTENEUR"
journal "restauration de la base « $NOM_BASE » (projet $PROJET)..."
# --no-owner / --no-acl : le rôle de la pile neuve est celui de son propre .env. --single-transaction : tout ou rien.
docker exec "$PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error --single-transaction "$1"' _ "$DUMP_CONTENEUR" \
  || echec "pg_restore a échoué : la base est restée vide (transaction unique). Corriger puis relancer."
journal "base restaurée"

# --- Documents -----------------------------------------------------------------------------------------------------------
AIDE="restauration-aide-$$"
docker create --name "$AIDE" --entrypoint sh -v "$VOLUME:/donnees" "$IMAGE" -c 'tar xzf /tmp/documents.tgz -C /donnees --numeric-owner' >/dev/null
docker cp "$(chemin_hote "$JEU/documents.tgz")" "$AIDE:/tmp/documents.tgz"
docker start -a "$AIDE" >/dev/null || echec "l'extraction des documents a échoué (la base, elle, est déjà restaurée)."
docker rm -f "$AIDE" >/dev/null
AIDE=""
journal "documents restaurés dans le volume « $VOLUME »"

# --- Vérifications -------------------------------------------------------------------------------------------------------
CODE=0
fautif() { printf '[%s] %s ÉCHEC  : %s\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$*" >&2; CODE=4; }
conforme() { journal "conforme : $*"; }

# 1. Migrations.
RACINE_HOTE="$(chemin_hote "$RACINE")"
ARGS_COMPOSE=(-p "$PROJET" --project-directory "$RACINE_HOTE" -f "$RACINE_HOTE/docker-compose.yml")
[ -z "${ENV_FILE:-}" ] || ARGS_COMPOSE+=(--env-file "$(chemin_hote "$ENV_FILE")")
sortie_migrations=""
if sortie_migrations="$(docker compose "${ARGS_COMPOSE[@]}" run --rm -T --no-deps outils npx prisma migrate status 2>&1)"; then
  conforme "migrations : $(printf '%s' "$sortie_migrations" | grep -i 'up to date' | head -n 1)"
elif printf '%s' "$sortie_migrations" | grep -qi 'have not yet been applied'; then
  avertir "la sauvegarde est plus ancienne que le code : des migrations restent à appliquer (docker compose -p $PROJET up -d --build les applique)."
  printf '%s\n' "$sortie_migrations" | sed 's/^/    /' >&2
else
  printf '%s\n' "$sortie_migrations" | sed 's/^/    /' >&2
  fautif "prisma migrate status n'est pas conforme."
fi

# 2. Nombre de lignes : égal à celui du manifeste (ou compris entre le comptage d'avant et d'après le pg_dump si la base a bougé).
for t in "${tables_a_comparer[@]}"; do
  restaure="$(sql "$PG" "select count(*) from \"$t\"")" || { fautif "impossible de compter la table « $t »."; continue; }
  if [ "$restaure" -ge "${compte_min[$t]}" ] && [ "$restaure" -le "${compte_max[$t]}" ]; then
    if [ "${compte_min[$t]}" = "${compte_max[$t]}" ]; then
      conforme "$t : $restaure ligne(s) (sauvegarde : ${compte_min[$t]})"
    else
      conforme "$t : $restaure ligne(s) (la base a changé pendant la sauvegarde : entre ${compte_min[$t]} et ${compte_max[$t]})"
    fi
  else
    fautif "$t : $restaure ligne(s) après restauration, ${compte_min[$t]} à ${compte_max[$t]} attendue(s)."
  fi
done

# 3. Fichiers cités par la base (hors écritures différées : leur PDF est encore en base) présents dans le volume, et ouverture du plus récent.
#    Le contrôle se fait dans le conteneur du générateur : c'est lui qui lit ces fichiers en service.
DOCUMENTS="$(sql "$PG" "select chemin || E'\t' || empreinte from documents_emis d where not exists (select 1 from ecritures_differees e where e.document_id = d.id) order by d.id desc")" \
  || { fautif "impossible de lister les documents émis."; DOCUMENTS=""; }
if [ -z "$DOCUMENTS" ]; then
  avertir "aucun document émis dans la base : ouverture d'un PDF non vérifiée."
else
  SCRIPT_PDF="$(
    cat <<'FIN'
import hashlib, os, sys
from pypdf import PdfReader

racine = "/donnees/sortie/documents"
lignes = [ligne.rstrip("\n").split("\t") for ligne in sys.stdin if ligne.strip()]
absents = [chemin for chemin, _ in lignes if not os.path.isfile(os.path.join(racine, chemin))]
if absents:
    print("%d fichier(s) cité(s) par la base absent(s) du volume, par exemple %s" % (len(absents), absents[0]))
    sys.exit(2)
chemin, attendue = lignes[0]
complet = os.path.join(racine, chemin)
with open(complet, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != attendue:
        print("empreinte SHA-256 différente de celle de la base : %s" % chemin)
        sys.exit(3)
pages = len(PdfReader(complet).pages)
if pages < 1:
    print("le PDF n'a aucune page : %s" % chemin)
    sys.exit(4)
print("%d fichier(s) cité(s) par la base, tous présents ; PDF %s : %d page(s), empreinte conforme" % (len(lignes), chemin, pages))
FIN
  )"
  if sortie_pdf="$(printf '%s\n' "$DOCUMENTS" | docker exec -i "$GEN" python -I -c "$SCRIPT_PDF" 2>&1)"; then
    conforme "$sortie_pdf"
  else
    fautif "documents : $sortie_pdf"
  fi
fi

if [ "$CODE" = 0 ]; then
  journal "TERMINÉ : restauration conforme. Démarrer ensuite le reste de la pile : docker compose -p $PROJET up -d"
else
  echo "[$NOM_SCRIPT] restauration faite, mais au moins une vérification a échoué (voir ci-dessus)." >&2
fi
exit "$CODE"
