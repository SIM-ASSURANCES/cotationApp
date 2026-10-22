#!/usr/bin/env bash
# Essai complet de la sauvegarde et de la restauration sur une pile Docker JETABLE (étape 8) :
#   données inventées -> sauvegarde -> suppression de la pile -> restauration sur une pile neuve
#   -> comptes de lignes identiques et un PDF qui s'ouvre.
#
#   bash scripts/tests/sauvegarde-restauration.test.sh
#
# Le projet Docker est « sauvegarde-test » (jamais celui du serveur ni du développement) : ses conteneurs, son réseau et ses
# volumes sont créés, puis SUPPRIMÉS à la fin (docker compose down -v), quel que soit le résultat. Les secrets de la pile sont
# générés au hasard dans un dossier temporaire : le .env du dépôt n'est ni lu ni modifié. Prévoir quelques minutes la première
# fois (construction des images « outils » et « generateur », ensuite en cache).
set -Eeuo pipefail
export LC_ALL=C MSYS_NO_PATHCONV=1
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$REP/.." && pwd)"
RACINE="$(cd "$SCRIPTS/.." && pwd)"
# shellcheck source=../lib-sauvegarde.sh
. "$SCRIPTS/lib-sauvegarde.sh"

PROJET="sauvegarde-test"
TMP="$(mktemp -d)"
SAUVEGARDES="$TMP/sauvegardes"
mkdir -p "$SAUVEGARDES"
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
psql_pile() { # psql_pile <requête>
  sql "$(conteneur_service "$PROJET" postgres)" "$1"
}
compte() { psql_pile "select count(*) from \"$1\""; }
TABLES="clients cotations polices factures documents_emis"

[[ "$PROJET" == sauvegarde-test* ]] || { echo "projet inattendu : $PROJET"; exit 1; }
detruire_pile

# ---------------------------------------------------------------------------------------------------------------------
etape "1. Pile jetable « $PROJET » : base, générateur, migrations, données inventées"
dc up -d --build --wait postgres generateur >/dev/null
dc run --rm -T outils >/dev/null # migrate deploy : le vrai schéma, avec ses déclencheurs
GEN="$(conteneur_service "$PROJET" generateur)"
PG="$(conteneur_service "$PROJET" postgres)"
docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <"$REP/donnees-inventees.sql"

# Trois vrais PDF écrits par le code de stockage du générateur (mêmes droits, même propriétaire qu'en service).
SCRIPT_PDF="$(
  cat <<'FIN'
import io, sys
from pathlib import Path
from pypdf import PdfWriter
from app import stockage

racine = stockage.racine(Path("/donnees/sortie"))
for numero, chemin in enumerate(sys.argv[1:], start=1):
    ecriture = PdfWriter()
    ecriture.add_blank_page(width=210, height=297)
    ecriture.add_metadata({"/Title": "Document inventé %d" % numero})
    tampon = io.BytesIO()
    ecriture.write(tampon)
    contenu = tampon.getvalue()
    print(chemin, stockage.ecrire(racine, chemin, contenu), len(contenu))
FIN
)"
CHEMINS=(
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/cotation-1.pdf"
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001/contrat-1.pdf"
  "ESSAI_PRINCIPALE/ESSAIPROD/CLI-1/COT-2026-10-0001/POL-2026-900001/FAC-2026-10-0001/facture-1.pdf"
)
PDF_EMPREINTES="$(docker exec "$GEN" python -c "$SCRIPT_PDF" "${CHEMINS[@]}")"
SQL_DOCUMENTS="$TMP/documents.sql"
numero=0
: >"$SQL_DOCUMENTS"
while read -r chemin empreinte taille; do
  numero=$((numero + 1))
  jeton="$(aleatoire)$(aleatoire)"
  cat >>"$SQL_DOCUMENTS" <<FIN
insert into documents_emis (type, numero, version, jeton, chemin, empreinte, taille, produit_code, souscripteur_nom, souscripteur_masque,
                            date_emission, modele_version_id, versions_associees, parametres_date, donnees, emis_par)
select 'COTATION', 'COT-ESSAI-$numero', 1, '$jeton', '$chemin', '$empreinte', $taille, 'ESSAIPROD', 'Client Inventé Un', 'C. I. U.',
       date '2026-10-22', mv.id, '{}'::jsonb, date '2026-01-01', '{}'::jsonb, 'test-sauvegarde'
from modele_versions mv limit 1;
FIN
done <<<"$PDF_EMPREINTES"
docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <"$SQL_DOCUMENTS"

declare -A attendu=()
for t in $TABLES; do attendu[$t]="$(compte "$t")"; done
verifier "données inventées : 3 clients, 3 cotations, 2 polices, 2 factures, 3 documents émis" \
  "3 3 2 2 3" "${attendu[clients]} ${attendu[cotations]} ${attendu[polices]} ${attendu[factures]} ${attendu[documents_emis]}"

# ---------------------------------------------------------------------------------------------------------------------
etape "2. Refus de la sauvegarde (avant d'écrire quoi que ce soit)"
refus "DOSSIER_SAUVEGARDE vide" "DOSSIER_SAUVEGARDE est vide" env DOSSIER_SAUVEGARDE="" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "DOSSIER_SAUVEGARDE absente de l'environnement" "DOSSIER_SAUVEGARDE est vide" env -u DOSSIER_SAUVEGARDE bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "DOSSIER_SAUVEGARDE relatif" "chemin absolu" env DOSSIER_SAUVEGARDE="sauvegardes" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "DOSSIER_SAUVEGARDE à l'intérieur du volume des documents" "à l'intérieur des données du projet" \
  env DOSSIER_SAUVEGARDE="/var/lib/docker/volumes/${PROJET}_documents/_data/sauvegardes" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "DOSSIER_SAUVEGARDE à l'intérieur du volume de la base" "à l'intérieur des données du projet" \
  env DOSSIER_SAUVEGARDE="/var/lib/docker/volumes/${PROJET}_donnees_postgres/_data" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "dossier cible inexistant (disque non monté)" "n'existe pas" env DOSSIER_SAUVEGARDE="$TMP/absent" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
refus "type de sauvegarde inconnu" "type inconnu" env DOSSIER_SAUVEGARDE="$SAUVEGARDES" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t mensuelle
refus "projet sans pile" "aucun conteneur" env DOSSIER_SAUVEGARDE="$SAUVEGARDES" bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET-inexistant" -t quotidienne
verifier "aucun fichier écrit par les refus" "" "$(ls -A "$SAUVEGARDES")"

# ---------------------------------------------------------------------------------------------------------------------
etape "3. Sauvegarde quotidienne puis hebdomadaire"
export DOSSIER_SAUVEGARDE="$SAUVEGARDES"
bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t quotidienne
sleep 1
bash "$SCRIPTS/sauvegarde.sh" -p "$PROJET" -t hebdomadaire
unset DOSSIER_SAUVEGARDE
verifier "deux sauvegardes, aucun reste provisoire ni verrou" "2" "$(ls -A "$SAUVEGARDES" | wc -l | tr -d ' ')"
JEU="$SAUVEGARDES/$(ls -1 "$SAUVEGARDES" | grep _quotidienne$ | head -n 1)"
verifier "contenu d'une sauvegarde" "MANIFESTE.txt SHA256SUMS base.dump documents.tgz" "$(ls -1 "$JEU" | tr '\n' ' ' | sed 's/ $//')"
for t in $TABLES; do
  verifier "manifeste : $t" "COMPTE $t ${attendu[$t]} ${attendu[$t]}" "$(grep "^COMPTE $t " "$JEU/MANIFESTE.txt")"
done
verifier "manifeste : projet, type" "PROJET=$PROJET TYPE=quotidienne" "$(grep -E '^(PROJET|TYPE)=' "$JEU/MANIFESTE.txt" | tr '\n' ' ' | sed 's/ $//')"
verifier "SHA256SUMS vérifiable à la main" "OK" "$(cd "$JEU" && sha256sum -c --quiet SHA256SUMS && echo OK)"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) echo "  (droits 600 non vérifiables sous Windows : contrôle réservé à Linux)" ;;
  *) verifier "base.dump en 600 (données de santé : lecture réservée au propriétaire)" "600" "$(stat -c %a "$JEU/base.dump")" ;;
esac
# Une sauvegarde de la pile en service ne doit RIEN avoir modifié.
for t in $TABLES; do verifier "sauvegarde sans effet sur $t" "${attendu[$t]}" "$(compte "$t")"; done

# ---------------------------------------------------------------------------------------------------------------------
etape "4. Suppression de la pile (volumes compris) puis pile NEUVE"
detruire_pile
verifier "plus aucun volume du projet" "" "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJET")"
dc up -d --wait postgres generateur >/dev/null
PG="$(conteneur_service "$PROJET" postgres)"
GEN="$(conteneur_service "$PROJET" generateur)"
attendre_postgres "$PG" || { echo "PostgreSQL ne répond pas"; exit 1; }
verifier "base neuve : aucune table" "0" "$(psql_pile "select count(*) from pg_tables where schemaname = 'public'")"

# ---------------------------------------------------------------------------------------------------------------------
etape "5. Refus de la restauration (sans rien écrire)"
ABIME="$TMP/abime"
cp -r "$JEU" "$ABIME"
printf 'x' >>"$ABIME/documents.tgz"
refus "sauvegarde abîmée (empreinte)" "empreintes de la sauvegarde ne correspondent pas" bash "$SCRIPTS/restauration.sh" -p "$PROJET" -s "$ABIME"
refus "sauvegarde incomplète" "sauvegarde incomplète" bash "$SCRIPTS/restauration.sh" -p "$PROJET" -s "$TMP"
refus "projet sans pile" "aucun conteneur" bash "$SCRIPTS/restauration.sh" -p "$PROJET-inexistant" -s "$JEU"
docker exec "$GEN" sh -c 'mkdir -p /donnees/sortie/documents && echo intrus > /donnees/sortie/documents/intrus.pdf'
refus "volume des documents non vide" "REFUS : le volume" bash "$SCRIPTS/restauration.sh" -p "$PROJET" -s "$JEU"
verifier "la base est restée vide après le refus du volume" "0" "$(psql_pile "select count(*) from pg_tables where schemaname = 'public'")"
docker exec "$GEN" rm -f /donnees/sortie/documents/intrus.pdf

# ---------------------------------------------------------------------------------------------------------------------
etape "6. Restauration sur la pile neuve + vérifications du script"
sortie_restauration="$(bash "$SCRIPTS/restauration.sh" -p "$PROJET" -s "$JEU" 2>&1)" && code_restauration=0 || code_restauration=$?
printf '%s\n' "$sortie_restauration" | sed 's/^/    | /'
verifier "restauration : code de sortie 0" "0" "$code_restauration"
case "$sortie_restauration" in *"Database schema is up to date"*) ok "migrate status : base à jour" ;; *) ko "migrate status devait rapporter « up to date »" ;; esac
case "$sortie_restauration" in *"PDF "*"1 page(s), empreinte conforme"*) ok "le script a ouvert un PDF" ;; *) ko "le script devait ouvrir un PDF" ;; esac

etape "7. Contrôles INDÉPENDANTS du script (comptes, PDF)"
for t in $TABLES; do verifier "$t : comptes identiques à ceux d'avant la sauvegarde" "${attendu[$t]}" "$(compte "$t")"; done
# Tous les PDF d'origine s'ouvrent avec pypdf et gardent leur empreinte.
SCRIPT_CONTROLE="$(
  cat <<'FIN'
import hashlib, sys
from pypdf import PdfReader
for ligne in sys.stdin:
    chemin, attendue, _ = ligne.split()
    complet = "/donnees/sortie/documents/" + chemin
    donnees = open(complet, "rb").read()
    assert hashlib.sha256(donnees).hexdigest() == attendue, chemin
    assert len(PdfReader(complet).pages) == 1, chemin
    print("ok", chemin)
FIN
)"
verifier "3 PDF ouverts, empreintes d'origine" "3" "$(printf '%s\n' "$PDF_EMPREINTES" | docker exec -i "$GEN" python -I -c "$SCRIPT_CONTROLE" | grep -c '^ok ')"
verifier "propriétaire et droits conservés (uid 10001, lecture seule)" "10001 440" \
  "$(docker exec "$GEN" stat -c '%u %a' "/donnees/sortie/documents/${CHEMINS[0]}")"
refus "la restauration d'une seconde fois est refusée (la base n'est plus vide)" "REFUS : la base" bash "$SCRIPTS/restauration.sh" -p "$PROJET" -s "$JEU"
for t in $TABLES; do verifier "$t : inchangé après le refus" "${attendu[$t]}" "$(compte "$t")"; done

# ---------------------------------------------------------------------------------------------------------------------
echo
if [ "$echecs" = 0 ]; then
  echo "Sauvegarde et restauration : tous les contrôles passent. La pile « $PROJET » va être supprimée."
else
  echo "Sauvegarde et restauration : $echecs contrôle(s) en échec."
  exit 1
fi
