#!/usr/bin/env bash
# Alerte de sauvegarde (étape 10, point 8) : à lancer par cron, après l'heure de la sauvegarde quotidienne. Elle vérifie que la
# dernière sauvegarde QUOTIDIENNE du dossier a moins de 26 heures ; sinon elle alerte, par courriel si un envoi est configuré,
# et toujours par une ligne ERREUR sur la sortie d'erreur (le journal redirigé par cron, et le courrier de cron) et par syslog.
#
#   alerte-sauvegarde.sh [-d DOSSIER] [-h HEURES] [-c ADRESSE] [-n 'AAAA-MM-JJ HH:MM:SS']
#     -d  dossier des sauvegardes (défaut : variable DOSSIER_SAUVEGARDE)
#     -h  âge maximal en heures (défaut : variable HEURES_MAX_SAUVEGARDE, sinon 26)
#     -c  adresse du courriel d'alerte (défaut : variable ALERTE_COURRIEL ; vide : pas de courriel)
#     -n  heure « maintenant » simulée, heure du serveur comme les noms des dossiers : sert aux tests
#
# Code de sortie : 0 = sauvegarde récente ; 1 = ALERTE (sauvegarde trop ancienne, absente, ou dossier introuvable) ;
# 3 = mauvais usage. Le courriel part par la commande « mail » (mailx) ou, à défaut, « sendmail » ; sans l'une ni l'autre, ou
# si l'envoi échoue, l'alerte reste écrite dans le journal (jamais perdue) et le code de sortie reste 1.
# Une sauvegarde compte si son dossier « AAAAMMJJ-HHMMSS_quotidienne » contient MANIFESTE.txt (le dossier n'apparaît qu'une fois
# la sauvegarde complète, voir sauvegarde.sh). Une hebdomadaire seule ne suffit pas : c'est la quotidienne qu'on surveille.
set -Eeuo pipefail
export LC_ALL=C
NOM_SCRIPT=alerte-sauvegarde
CODE_ECHEC=3
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-sauvegarde.sh
. "$REP/lib-sauvegarde.sh"

DOSSIER="${DOSSIER_SAUVEGARDE:-}"
HEURES="${HEURES_MAX_SAUVEGARDE:-26}"
COURRIEL="${ALERTE_COURRIEL:-}"
MAINTENANT_SIMULE=""
UTILISATION="usage : $0 [-d DOSSIER] [-h HEURES] [-c ADRESSE] [-n 'AAAA-MM-JJ HH:MM:SS']"
while getopts ":d:h:c:n:" option; do
  case "$option" in
    d) DOSSIER="$OPTARG" ;;
    h) HEURES="$OPTARG" ;;
    c) COURRIEL="$OPTARG" ;;
    n) MAINTENANT_SIMULE="$OPTARG" ;;
    *) echec "$UTILISATION" ;;
  esac
done
[ -n "$DOSSIER" ] || echec "dossier des sauvegardes absent (-d ou DOSSIER_SAUVEGARDE). $UTILISATION"
[[ "$HEURES" =~ ^[1-9][0-9]*$ ]] || echec "l'âge maximal est un nombre entier d'heures, au moins 1 (reçu : $HEURES)"
if [ -n "$MAINTENANT_SIMULE" ]; then
  [[ "$MAINTENANT_SIMULE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]] || echec "heure simulée invalide (attendu 'AAAA-MM-JJ HH:MM:SS') : $MAINTENANT_SIMULE"
  MAINTENANT="$(date -d "$MAINTENANT_SIMULE" +%s 2>/dev/null)" || echec "heure simulée invalide : $MAINTENANT_SIMULE"
else
  MAINTENANT="$(date +%s)"
fi

# alerter <message> : écrit l'erreur (toujours), la signale à syslog si possible, envoie le courriel si configuré ; sort avec 1.
alerter() {
  local message="$1"
  printf '[%s] %s ERREUR : %s\n' "$NOM_SCRIPT" "$(date '+%F %T')" "$message" >&2
  if command -v logger >/dev/null 2>&1; then
    logger -t sim-sauvegarde -p user.err -- "$message" >/dev/null 2>&1 || true
  fi
  if [ -z "$COURRIEL" ]; then
    avertir "aucun courriel d'alerte configuré (ALERTE_COURRIEL ou -c) : l'alerte n'est écrite que dans ce journal."
  else
    local sujet="SIM Documents : ALERTE sauvegarde ($(hostname 2>/dev/null || echo serveur))"
    if command -v mail >/dev/null 2>&1; then
      printf '%s\n' "$message" | mail -s "$sujet" "$COURRIEL" || avertir "courriel non envoyé à $COURRIEL (échec de la commande mail) : l'alerte reste dans ce journal."
    elif command -v sendmail >/dev/null 2>&1; then
      printf 'To: %s\nSubject: %s\n\n%s\n' "$COURRIEL" "$sujet" "$message" | sendmail -t || avertir "courriel non envoyé à $COURRIEL (échec de sendmail) : l'alerte reste dans ce journal."
    else
      avertir "courriel non envoyé à $COURRIEL : ni « mail » ni « sendmail » sur ce serveur. L'alerte reste dans ce journal."
    fi
  fi
  exit 1
}

[ -d "$DOSSIER" ] || alerter "dossier des sauvegardes introuvable : $DOSSIER (disque non monté ?). Impossible de vérifier la dernière sauvegarde."

# Dernière quotidienne complète : le nom commence par la date, donc l'ordre alphabétique est l'ordre du temps.
derniere=""
for candidat in "$DOSSIER"/*/; do
  nom="${candidat%/}"
  nom="${nom##*/}"
  [[ "$nom" =~ ^([0-9]{8})-([0-9]{6})_quotidienne$ ]] || continue
  [ -f "$DOSSIER/$nom/MANIFESTE.txt" ] || continue
  d="${BASH_REMATCH[1]}"
  h="${BASH_REMATCH[2]}"
  date -d "${d:0:4}-${d:4:2}-${d:6:2} ${h:0:2}:${h:2:2}:${h:4:2}" +%s >/dev/null 2>&1 || continue # date impossible : ignorée
  derniere="$nom"
done
[ -n "$derniere" ] || alerter "aucune sauvegarde quotidienne complète dans $DOSSIER."

d="${derniere:0:8}"
h="${derniere:9:6}"
libelle="${d:0:4}-${d:4:2}-${d:6:2} ${h:0:2}:${h:2:2}:${h:4:2}"
age=$((MAINTENANT - $(date -d "$libelle" +%s)))
if [ "$age" -lt 0 ]; then
  avertir "la dernière sauvegarde ($libelle) est datée du futur : horloge du serveur déréglée ?"
  age=0
fi
if [ "$age" -gt $((HEURES * 3600)) ]; then
  alerter "la dernière sauvegarde quotidienne date du $libelle (il y a $((age / 3600)) h $(((age % 3600) / 60)) min), plus de $HEURES h : la sauvegarde ne tourne plus ou échoue. Dossier : $DOSSIER."
fi
journal "sauvegarde récente : $libelle (il y a $((age / 3600)) h $(((age % 3600) / 60)) min, limite $HEURES h)."
