# Fonctions communes à sauvegarde.sh et restauration.sh (à « sourcer », pas à lancer).
# Les conteneurs et volumes sont retrouvés par les étiquettes que Docker Compose pose lui-même
# (com.docker.compose.project / .service / .volume) : aucune dépendance au nom des conteneurs ni au fichier .env.

# Git Bash (Windows) réécrit les chemins qui ressemblent à /tmp/... passés à docker.exe : sans effet sous Linux.
export MSYS_NO_PATHCONV=1

NOM_SCRIPT="${NOM_SCRIPT:-sauvegarde}"

journal() { printf '[%s] %s %s\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$*"; }
avertir() { printf '[%s] %s AVERTISSEMENT : %s\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$*" >&2; }
echec() {
  printf '[%s] %s ERREUR : %s\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$*" >&2
  exit "${CODE_ECHEC:-1}"
}

exiger_commandes() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || echec "commande introuvable : $c"
  done
}

# Chemin de l'hôte tel que docker (le client) le comprend : Git Bash a besoin du format Windows, Linux du chemin tel quel.
if command -v cygpath >/dev/null 2>&1; then
  chemin_hote() { cygpath -w -- "$1"; }
else
  chemin_hote() { printf '%s' "$1"; }
fi

# conteneur_service <projet> <service> : identifiant du conteneur EN MARCHE, vide s'il n'y en a pas.
conteneur_service() {
  docker ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2" \
    --filter status=running | head -n 1
}

# volume_projet <projet> <volume> : nom Docker du volume (ex. sim-documents_documents), vide s'il n'existe pas.
volume_projet() {
  docker volume ls -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.volume=$2" | head -n 1
}

# sql <conteneur postgres> <requête> : une valeur par ligne, sans en-tête, arrêt à la première erreur.
sql() {
  docker exec "$1" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At -c "$1"' _ "$2"
}

# attendre_postgres <conteneur> : sur une base neuve, le healthcheck (pg_isready par le socket) passe pendant le serveur
# TEMPORAIRE d'initialisation de l'image, qui s'arrête puis redémarre. Seul le serveur définitif écoute en TCP : on l'attend.
attendre_postgres() {
  local i
  for i in $(seq 1 60); do
    if docker exec "$1" sh -c 'pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && sql "$1" 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# refuser_dans_donnees <projet> <dossier absolu normalisé> <nom de la variable> : refuse (echec) un dossier situé à l'intérieur
# d'un volume du projet ou d'un montage de ses conteneurs (arrêtés compris) : une copie qui vit avec les données ne les protège pas.
refuser_dans_donnees() {
  local v c source
  while IFS= read -r source; do
    [ -n "$source" ] || continue
    source="$(realpath -m -- "$source")"
    case "$2/" in
      "$source"/*) echec "$3 ($2) est à l'intérieur des données du projet ($source) : choisir un disque ou un serveur distinct." ;;
    esac
  done < <(
    while read -r v; do docker volume inspect -f '{{.Mountpoint}}' "$v"; done < <(docker volume ls -q --filter "label=com.docker.compose.project=$1")
    while read -r c; do docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$c"; done < <(docker ps -aq --filter "label=com.docker.compose.project=$1")
  )
}

# Les noms de tables viennent de l'environnement : on n'accepte que des identifiants simples.
valider_tables() {
  local t
  for t in "$@"; do
    [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || echec "nom de table invalide : $t"
  done
}

# Tables dont le nombre de lignes est comparé entre la base sauvegardée et la base restaurée (étape 8).
TABLES_CLES_DEFAUT="clients cotations polices factures documents_emis"
