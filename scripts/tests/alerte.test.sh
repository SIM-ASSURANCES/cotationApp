#!/usr/bin/env bash
# Test de l'alerte de sauvegarde avec des DATES SIMULÉES (étape 10, point 8). N'utilise ni Docker ni la base : des dossiers vides,
# et de faux « mail » et « logger » placés en tête du PATH (aucun courriel ni message syslog réel).
#   bash scripts/tests/alerte.test.sh
set -Eeuo pipefail
export LC_ALL=C
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALERTE="$REP/../alerte-sauvegarde.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echecs=0
ok() { printf '  ok      %s\n' "$1"; }
ko() { printf '  ÉCHEC   %s\n' "$1"; echecs=$((echecs + 1)); }
verifier() { # verifier <description> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $2 », obtenu « $3 »)"; fi
}
contient() { # contient <description> <texte> <motif>
  if grep -qF -- "$3" <<<"$2"; then ok "$1"; else ko "$1 (« $3 » absent de : $2)"; fi
}

# Faux programmes d'envoi : ils notent ce qu'ils reçoivent. FAUX_MAIL_ECHOUE=1 simule un envoi qui échoue.
mkdir "$TMP/bin"
cat >"$TMP/bin/mail" <<FIN
#!/usr/bin/env bash
{ printf 'ARGS:%s\n' "\$*"; cat; } >>"$TMP/courriels.txt"
[ "\${FAUX_MAIL_ECHOUE:-0}" = 1 ] && exit 1
exit 0
FIN
cat >"$TMP/bin/logger" <<FIN
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$TMP/syslog.txt"
FIN
chmod +x "$TMP/bin/mail" "$TMP/bin/logger"

jeu() { mkdir -p "$1/$2" && : >"$1/$2/MANIFESTE.txt"; } # jeu <dossier> <nom> : une « sauvegarde » vide
# lancer <args…> : lance l'alerte avec les faux programmes ; remplit CODE et ERREURS (sortie d'erreur) ; vide courriels et syslog avant.
lancer() {
  : >"$TMP/courriels.txt"
  : >"$TMP/syslog.txt"
  CODE=0
  ERREURS="$(PATH="$TMP/bin:$PATH" bash "$ALERTE" "$@" 2>&1 >/dev/null)" || CODE=$?
}

# ---------------------------------------------------------------------------------------------------------------------
echo "A. Âge de la dernière quotidienne (sauvegarde du 2026-10-20 à 02:00:00, limite de 26 h)"
A="$TMP/a"
jeu "$A" 20261020-020000_quotidienne
lancer -d "$A" -n "2026-10-20 07:00:00"; verifier "5 h après : pas d'alerte" 0 "$CODE"
lancer -d "$A" -n "2026-10-21 02:00:00"; verifier "24 h après : pas d'alerte" 0 "$CODE"
lancer -d "$A" -n "2026-10-21 04:00:00"; verifier "26 h pile : pas d'alerte (la limite n'est pas dépassée)" 0 "$CODE"
lancer -d "$A" -n "2026-10-21 04:00:01"; verifier "26 h et 1 s : alerte" 1 "$CODE"
contient "le message cite la date de la dernière sauvegarde" "$ERREURS" "2026-10-20 02:00:00"
contient "le message cite l'âge" "$ERREURS" "il y a 26 h 0 min"
contient "le message est une ligne ERREUR" "$ERREURS" "ERREUR"
lancer -d "$A" -n "2026-10-22 09:30:00"; verifier "55 h 30 après : alerte" 1 "$CODE"
contient "âge en heures et minutes" "$ERREURS" "il y a 55 h 30 min"
lancer -d "$A" -n "2026-10-22 09:30:00" -h 72; verifier "limite portée à 72 h (-h) : pas d'alerte" 0 "$CODE"
lancer -d "$A" -n "2026-10-19 12:00:00"; verifier "sauvegarde datée du futur (horloge déréglée) : pas d'alerte, avertissement" 0 "$CODE"

# ---------------------------------------------------------------------------------------------------------------------
echo "B. Quelle sauvegarde compte"
B="$TMP/b"
jeu "$B" 20261018-020000_quotidienne
jeu "$B" 20261021-030000_hebdomadaire
lancer -d "$B" -n "2026-10-21 12:00:00"; verifier "une hebdomadaire récente ne remplace pas la quotidienne : alerte" 1 "$CODE"
contient "c'est la quotidienne du 18 qui est citée" "$ERREURS" "2026-10-18 02:00:00"
jeu "$B" 20261021-020000_quotidienne
lancer -d "$B" -n "2026-10-21 12:00:00"; verifier "la quotidienne la plus récente est retenue : pas d'alerte" 0 "$CODE"
mkdir -p "$B/20261022-020000_quotidienne" # dossier sans MANIFESTE.txt : sauvegarde incomplète, ignorée
lancer -d "$B" -n "2026-10-23 12:00:00"; verifier "dossier sans MANIFESTE.txt ignoré : alerte (dernière complète = le 21)" 1 "$CODE"
contient "la dernière complète est citée" "$ERREURS" "2026-10-21 02:00:00"
mkdir -p "$B/20261023-020000_quotidienne.tmp" "$B/divers"
lancer -d "$B" -n "2026-10-21 12:00:00"; verifier "dossiers étrangers ignorés" 0 "$CODE"
jeu "$B" 20261399-020000_quotidienne # date impossible
lancer -d "$B" -n "2026-10-21 12:00:00"; verifier "date impossible dans un nom : ignorée" 0 "$CODE"

# ---------------------------------------------------------------------------------------------------------------------
echo "C. Dossier vide, absent, ou de la variable d'environnement"
mkdir "$TMP/vide"
lancer -d "$TMP/vide" -n "2026-10-21 12:00:00"; verifier "dossier sans sauvegarde : alerte" 1 "$CODE"
contient "message : aucune sauvegarde" "$ERREURS" "aucune sauvegarde quotidienne complète"
lancer -d "$TMP/inexistant" -n "2026-10-21 12:00:00"; verifier "dossier introuvable (disque non monté) : alerte, pas une erreur d'usage" 1 "$CODE"
contient "message : dossier introuvable" "$ERREURS" "introuvable"
CODE=0; ERREURS="$(DOSSIER_SAUVEGARDE="$A" PATH="$TMP/bin:$PATH" bash "$ALERTE" -n "2026-10-20 07:00:00" 2>&1 >/dev/null)" || CODE=$?
verifier "le dossier peut venir de DOSSIER_SAUVEGARDE" 0 "$CODE"

# ---------------------------------------------------------------------------------------------------------------------
echo "D. Courriel, journal et syslog"
lancer -d "$A" -n "2026-10-22 09:30:00"
contient "sans courriel configuré : l'erreur est dans le journal" "$ERREURS" "ERREUR"
contient "sans courriel configuré : le journal le dit" "$ERREURS" "aucun courriel d'alerte configuré"
verifier "sans courriel configuré : aucun courriel parti" "" "$(cat "$TMP/courriels.txt")"
contient "syslog prévenu" "$(cat "$TMP/syslog.txt")" "la dernière sauvegarde quotidienne date du 2026-10-20 02:00:00"
lancer -d "$A" -n "2026-10-22 09:30:00" -c "technique@exemple.invalide"; verifier "avec courriel : code 1 aussi" 1 "$CODE"
contient "le courriel part à la bonne adresse" "$(cat "$TMP/courriels.txt")" "technique@exemple.invalide"
contient "le sujet annonce l'alerte" "$(cat "$TMP/courriels.txt")" "ALERTE sauvegarde"
contient "le corps donne la date de la dernière sauvegarde" "$(cat "$TMP/courriels.txt")" "2026-10-20 02:00:00"
contient "l'erreur reste aussi dans le journal" "$ERREURS" "ERREUR"
lancer -d "$A" -n "2026-10-20 07:00:00" -c "technique@exemple.invalide"
verifier "sauvegarde récente : aucun courriel" "" "$(cat "$TMP/courriels.txt")"
: >"$TMP/courriels.txt"
CODE=0; ERREURS="$(ALERTE_COURRIEL="technique@exemple.invalide" PATH="$TMP/bin:$PATH" bash "$ALERTE" -d "$A" -n "2026-10-22 09:30:00" 2>&1 >/dev/null)" || CODE=$?
contient "l'adresse peut venir de ALERTE_COURRIEL" "$(cat "$TMP/courriels.txt")" "technique@exemple.invalide"
: >"$TMP/courriels.txt"
CODE=0; ERREURS="$(FAUX_MAIL_ECHOUE=1 PATH="$TMP/bin:$PATH" bash "$ALERTE" -d "$A" -n "2026-10-22 09:30:00" -c "technique@exemple.invalide" 2>&1 >/dev/null)" || CODE=$?
verifier "envoi qui échoue : code 1, l'alerte n'est pas perdue" 1 "$CODE"
contient "envoi qui échoue : le journal garde l'alerte" "$ERREURS" "ERREUR"
contient "envoi qui échoue : le journal le dit" "$ERREURS" "courriel non envoyé"

# ---------------------------------------------------------------------------------------------------------------------
echo "E. Mauvais usage (code 3, distinct de l'alerte)"
lancer -n "2026-10-21 12:00:00"; verifier "sans dossier" 3 "$CODE"
lancer -d "$A" -h 0; verifier "âge maximal nul" 3 "$CODE"
lancer -d "$A" -h abc; verifier "âge maximal non numérique" 3 "$CODE"
lancer -d "$A" -n "hier"; verifier "heure simulée invalide" 3 "$CODE"
lancer -d "$A" -n "2026-13-45 99:00:00"; verifier "heure simulée impossible" 3 "$CODE"
lancer -z; verifier "option inconnue" 3 "$CODE"

echo
if [ "$echecs" -eq 0 ]; then echo "Tous les contrôles sont passés."; else echo "$echecs contrôle(s) en échec."; exit 1; fi
