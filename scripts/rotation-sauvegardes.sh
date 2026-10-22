#!/usr/bin/env bash
# Rotation des sauvegardes d'un dossier (CDC §14.3, étape 8). Appelée par sauvegarde.sh après chaque sauvegarde réussie ;
# peut aussi se lancer seule, avec une date simulée, pour voir ce qui serait gardé.
#
#   rotation-sauvegardes.sh -d DOSSIER [-n AAAA-MM-JJ] [-s] [-v]
#     -d  dossier qui contient les sauvegardes (obligatoire)
#     -n  date du jour simulée (défaut : aujourd'hui) : sert aux tests
#     -s  simulation : affiche, ne supprime rien
#     -v  affiche aussi les sauvegardes gardées, avec la raison
#
# Une sauvegarde est un dossier « AAAAMMJJ-HHMMSS_quotidienne » ou « AAAAMMJJ-HHMMSS_hebdomadaire » qui contient
# MANIFESTE.txt. Elle est GARDÉE si elle remplit au moins un de ces rôles :
#   - l'une des 7 dernières quotidiennes / l'une des 8 dernières hebdomadaires ;
#   - MENSUELLE : la toute première sauvegarde (de tout type) d'un mois civil, pour les 12 derniers mois civils (mois en cours compris) ;
#   - ANNUELLE : la toute première sauvegarde d'une année civile, pour les 10 dernières années civiles (année en cours comprise).
# Les rôles sont déduits des noms : aucun état à conserver, le résultat ne dépend que du contenu du dossier et de la date.
# Une sauvegarde mensuelle ou annuelle n'est donc jamais supprimée par la rotation des quotidiennes et des hebdomadaires ;
# elle ne l'est qu'une fois sa durée de conservation écoulée (12 mois, 10 ans). Rien d'autre que ces dossiers n'est touché.
set -Eeuo pipefail
export LC_ALL=C
NOM_SCRIPT=rotation
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-sauvegarde.sh
. "$REP/lib-sauvegarde.sh"

QUOTIDIENNES="${QUOTIDIENNES_A_GARDER:-7}"
HEBDOMADAIRES="${HEBDOMADAIRES_A_GARDER:-8}"
MENSUELLES="${MENSUELLES_A_GARDER:-12}"
ANNUELLES="${ANNUELLES_A_GARDER:-10}"

DOSSIER=""
AUJOURDHUI=""
SIMULATION=0
BAVARD=0
while getopts ":d:n:sv" option; do
  case "$option" in
    d) DOSSIER="$OPTARG" ;;
    n) AUJOURDHUI="$OPTARG" ;;
    s) SIMULATION=1 ;;
    v) BAVARD=1 ;;
    *) echec "usage : $0 -d DOSSIER [-n AAAA-MM-JJ] [-s] [-v]" ;;
  esac
done
[ -n "$DOSSIER" ] || echec "usage : $0 -d DOSSIER [-n AAAA-MM-JJ] [-s] [-v]"
[ -d "$DOSSIER" ] || echec "dossier introuvable : $DOSSIER"
for valeur in "$QUOTIDIENNES" "$HEBDOMADAIRES" "$MENSUELLES" "$ANNUELLES"; do
  [[ "$valeur" =~ ^[0-9]+$ ]] || echec "les durées de conservation sont des nombres entiers positifs (reçu : $valeur)"
done

[ -n "$AUJOURDHUI" ] || AUJOURDHUI="$(date +%F)"
[[ "$AUJOURDHUI" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})$ ]] || echec "date du jour invalide (attendu AAAA-MM-JJ) : $AUJOURDHUI"
an_ref=$((10#${BASH_REMATCH[1]}))
mois_ref=$((10#${BASH_REMATCH[2]}))
indice_ref=$((an_ref * 12 + mois_ref))

# Sauvegardes reconnues, de la plus ancienne à la plus récente (le nom commence par la date, donc l'ordre alphabétique est l'ordre du temps).
noms=()
for candidat in "$DOSSIER"/*/; do
  nom="${candidat%/}"
  nom="${nom##*/}"
  [[ "$nom" =~ ^[0-9]{8}-[0-9]{6}_(quotidienne|hebdomadaire)$ ]] || continue
  [ -f "$DOSSIER/$nom/MANIFESTE.txt" ] || continue
  noms+=("$nom")
done

declare -A raisons=()
ajouter_raison() { raisons["$1"]="${raisons[$1]:+${raisons[$1]}, }$2"; }

# 1. Les N dernières de chaque type.
declare -A rang=([quotidienne]=0 [hebdomadaire]=0)
for ((i = ${#noms[@]} - 1; i >= 0; i--)); do
  nom="${noms[$i]}"
  type="${nom##*_}"
  limite=$QUOTIDIENNES
  [ "$type" = hebdomadaire ] && limite=$HEBDOMADAIRES
  rang[$type]=$((rang[$type] + 1))
  if ((rang[$type] <= limite)); then
    ajouter_raison "$nom" "$type ${rang[$type]}/$limite"
  fi
done

# 2. La première de chaque mois et de chaque année, tant que la durée de conservation n'est pas écoulée.
#    Le premier de la période est repéré même s'il est expiré : une suivante ne prend jamais sa place.
declare -A mois_vus=() annees_vues=()
for nom in "${noms[@]}"; do
  annee=$((10#${nom:0:4}))
  mois=$((10#${nom:4:2}))
  cle_mois="${nom:0:6}"
  if [ -z "${mois_vus[$cle_mois]:-}" ]; then
    mois_vus[$cle_mois]=1
    if ((indice_ref - (annee * 12 + mois) < MENSUELLES)); then
      ajouter_raison "$nom" "mensuelle ${nom:0:4}-${nom:4:2}"
    fi
  fi
  if [ -z "${annees_vues[$annee]:-}" ]; then
    annees_vues[$annee]=1
    if ((an_ref - annee < ANNUELLES)); then
      ajouter_raison "$nom" "annuelle $annee"
    fi
  fi
done

# 3. Suppression de ce qui n'a plus aucun rôle.
gardees=0
supprimees=0
for nom in "${noms[@]}"; do
  if [ -n "${raisons[$nom]:-}" ]; then
    gardees=$((gardees + 1))
    ((BAVARD)) && printf 'GARDER     %s  (%s)\n' "$nom" "${raisons[$nom]}"
    continue
  fi
  supprimees=$((supprimees + 1))
  if ((SIMULATION)); then
    printf 'SUPPRIMER  %s  (simulation)\n' "$nom"
  else
    # Le nom a déjà été validé par l'expression régulière ci-dessus : jamais de chemin construit à partir d'autre chose.
    rm -rf -- "${DOSSIER:?}/$nom"
    printf 'SUPPRIMER  %s\n' "$nom"
  fi
done
if ((SIMULATION)); then
  journal "au $AUJOURDHUI : $gardees sauvegarde(s) gardée(s), $supprimees à supprimer (simulation, rien n'est supprimé)."
else
  journal "au $AUJOURDHUI : $gardees sauvegarde(s) gardée(s), $supprimees supprimée(s)."
fi
