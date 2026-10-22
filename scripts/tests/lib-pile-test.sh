# Préparation commune des essais Docker (sauvegarde-restauration.test.sh, export-archive.test.sh) : à « sourcer » après avoir
# fixé PROJET (« sauvegarde-test » ou « export-test »). Crée une pile JETABLE (base, générateur), applique les vraies migrations,
# y met des données INVENTÉES et de vrais fichiers PDF écrits par le code de stockage du générateur ; la pile (volumes compris) et
# le dossier temporaire sont supprimés à la sortie, quel que soit le résultat. Le .env du dépôt n'est ni lu ni modifié.
set -Eeuo pipefail
export LC_ALL=C MSYS_NO_PATHCONV=1
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$REP/.." && pwd)"
RACINE="$(cd "$SCRIPTS/.." && pwd)"
# shellcheck source=../lib-sauvegarde.sh
. "$SCRIPTS/lib-sauvegarde.sh"

[[ "${PROJET:-}" == sauvegarde-test* || "${PROJET:-}" == export-test* ]] || { echo "projet de test inattendu : ${PROJET:-}"; exit 1; }
TMP="$(mktemp -d)"
ENV_FILE="$TMP/essai.env"

aleatoire() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
cat >"$ENV_FILE" <<FIN
POSTGRES_USER=essai
POSTGRES_DB=essai_documents
POSTGRES_PASSWORD=$(aleatoire)
REDIS_PASSWORD=$(aleatoire)
GENERATEUR_SECRET=$(aleatoire)
AUTH_SECRET=$(aleatoire)
FIN
export ENV_FILE

dc() {
  docker compose -p "$PROJET" --project-directory "$(chemin_hote "$RACINE")" -f "$(chemin_hote "$RACINE")/docker-compose.yml" \
    --env-file "$(chemin_hote "$ENV_FILE")" "$@"
}
detruire_pile() { dc down -v --remove-orphans >/dev/null 2>&1 || true; }
fin() {
  local code=$?
  trap - EXIT
  detruire_pile
  rm -rf "$TMP"
  exit "$code"
}
trap fin EXIT
trap 'exit 130' INT TERM

echecs=0
etape() { printf '\n== %s\n' "$*"; }
ok() { printf '  ok      %s\n' "$1"; }
ko() { printf '  ÉCHEC   %s\n' "$1"; echecs=$((echecs + 1)); }
verifier() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $2 », obtenu « $3 »)"; fi; }
# refus <description> <motif attendu dans la sortie> <commande...> : la commande doit échouer et dire pourquoi.
refus() {
  local description="$1" motif="$2" sortie
  shift 2
  if sortie="$("$@" 2>&1)"; then ko "$description : la commande aurait dû être refusée"; return; fi
  case "$sortie" in *"$motif"*) ok "$description" ;; *) ko "$description : refusée, mais pas pour la bonne raison : $sortie" ;; esac
}
psql_pile() { sql "$(conteneur_service "$PROJET" postgres)" "$1"; }
compte() { psql_pile "select count(*) from \"$1\""; }
TABLES="clients cotations polices factures documents_emis"

# Fichiers écrits dans le volume (le dernier est l'archive ZIP d'un import en masse, listée par lots_import).
CHEMINS=(
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/cotation-1.pdf"
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001/contrat-1.pdf"
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001/FAC-2026-10-0001/facture-1.pdf"
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001/AVN-01/import-lot-1.zip"
)

# preparer_pile_avec_donnees : pile, migrations, données, fichiers. Positionne PG, GEN, PDF_EMPREINTES (lignes « chemin empreinte
# taille » des PDF), ZIP_EMPREINTES (idem pour le ZIP) et le tableau attendu[table] (comptes de lignes avant tout essai).
preparer_pile_avec_donnees() {
  detruire_pile
  dc up -d --build --wait postgres generateur >/dev/null
  dc run --rm -T outils >/dev/null # migrate deploy : le vrai schéma, avec ses déclencheurs
  GEN="$(conteneur_service "$PROJET" generateur)"
  PG="$(conteneur_service "$PROJET" postgres)"
  docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <"$REP/donnees-inventees.sql"

  # Les fichiers sont écrits par stockage.ecrire (mêmes droits, même propriétaire qu'en service).
  local script_ecriture tous
  script_ecriture="$(
    cat <<'FIN'
import io, sys, zipfile
from pathlib import Path
from pypdf import PdfWriter
from app import stockage

racine = stockage.racine(Path("/donnees/sortie"))
for numero, chemin in enumerate(sys.argv[1:], start=1):
    if chemin.endswith(".zip"):
        tampon = io.BytesIO()
        with zipfile.ZipFile(tampon, "w") as archive:
            archive.writestr("adherents.txt", "archive d'import inventée\n")
        contenu = tampon.getvalue()
    else:
        ecriture = PdfWriter()
        ecriture.add_blank_page(width=210, height=297)
        ecriture.add_metadata({"/Title": "Document inventé %d" % numero})
        tampon = io.BytesIO()
        ecriture.write(tampon)
        contenu = tampon.getvalue()
    print(chemin, stockage.ecrire(racine, chemin, contenu), len(contenu))
FIN
  )"
  tous="$(docker exec "$GEN" python -c "$script_ecriture" "${CHEMINS[@]}")"
  PDF_EMPREINTES="$(printf '%s\n' "$tous" | grep '\.pdf ')"
  ZIP_EMPREINTES="$(printf '%s\n' "$tous" | grep '\.zip ')"

  local sql_documents="$TMP/documents.sql" numero=0 chemin empreinte taille jeton
  : >"$sql_documents"
  while read -r chemin empreinte taille; do
    numero=$((numero + 1))
    jeton="$(aleatoire)$(aleatoire)"
    cat >>"$sql_documents" <<FIN
insert into documents_emis (type, numero, version, jeton, chemin, empreinte, taille, produit_code, souscripteur_nom, souscripteur_masque,
                            date_emission, modele_version_id, versions_associees, parametres_date, donnees, emis_par)
select 'COTATION', 'COT-ESSAI-$numero', 1, '$jeton', '$chemin', '$empreinte', $taille, 'ESSAIPROD', 'Client Inventé Un', 'C. I. U.',
       date '2026-10-22', mv.id, '{}'::jsonb, date '2026-01-01', '{}'::jsonb, 'test-sauvegarde'
from modele_versions mv limit 1;
FIN
  done <<<"$PDF_EMPREINTES"
  read -r chemin empreinte taille <<<"$ZIP_EMPREINTES"
  cat >>"$sql_documents" <<FIN
insert into lots_import (police_id, produit_code, date_effet, fichier_nom, statut, total, valides, erreurs, zip_chemin, zip_empreinte, zip_taille, cree_par_id, cree_par)
select id, 'ESSAIPROD', date '2026-11-01', 'adherents-inventes.xlsx', 'TERMINE', 1, 1, 0, '$chemin', '$empreinte', $taille, 1, 'test-sauvegarde'
from polices order by id limit 1;
FIN
  docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <"$sql_documents"

  declare -gA attendu=()
  local t
  for t in $TABLES; do attendu[$t]="$(compte "$t")"; done
}
