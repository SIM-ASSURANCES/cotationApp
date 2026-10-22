#!/usr/bin/env bash
# Test de la rotation des sauvegardes avec des DATES SIMULÉES (étape 8). N'utilise ni Docker ni la base : il ne crée que des dossiers vides.
#   bash scripts/tests/rotation.test.sh
# Les listes attendues sont écrites à la main (calendrier 2024-2027), pas déduites du script testé.
set -Eeuo pipefail
export LC_ALL=C
REP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROTATION="$REP/../rotation-sauvegardes.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echecs=0
ok() { printf '  ok      %s\n' "$1"; }
ko() { printf '  ÉCHEC   %s\n' "$1"; echecs=$((echecs + 1)); }
verifier() { # verifier <description> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then ok "$1"; else
    ko "$1"
    diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") | sed 's/^/            /' || true
  fi
}

jeu() { mkdir -p "$1/$2" && : >"$1/$2/MANIFESTE.txt"; } # jeu <dossier> <nom> : une « sauvegarde » vide
liste() { (cd "$1" && ls -A1); }
rotation() { bash "$ROTATION" "$@" >/dev/null; } # rotation -d DOSSIER -n DATE

# ---------------------------------------------------------------------------------------------------------------------
echo "A. Fonctionnement jour après jour, du 2024-09-01 au 2026-10-22 (une quotidienne à 2 h, une hebdomadaire le dimanche à 3 h)"
A="$TMP/a"
mkdir "$A"
jour="2024-09-01"
fin="2026-10-22"
dow="$(date -d "$jour" +%u)" # 1 = lundi … 7 = dimanche
manquantes=0
while :; do
  sans_tirets="${jour//-/}"
  jeu "$A" "${sans_tirets}-020000_quotidienne"
  [ "$dow" = 7 ] && jeu "$A" "${sans_tirets}-030000_hebdomadaire"
  rotation -d "$A" -n "$jour"
  # Invariant : la première sauvegarde du mois en cours et celle d'il y a 11 mois (encore dans la fenêtre) ne disparaissent jamais.
  if [ "${jour:8:2}" = 15 ]; then
    courant="${jour:0:4}${jour:5:2}01-020000_quotidienne"
    ancien="$(date -d "${jour:0:7}-01 - 11 months" +%Y%m%d)-020000_quotidienne"
    [ -d "$A/$courant" ] || { ko "$jour : la mensuelle du mois en cours ($courant) a disparu"; manquantes=1; }
    # avant le départ de la simulation, il n'y a rien à retrouver
    if [ "${ancien:0:8}" -ge 20240901 ] && [ ! -d "$A/$ancien" ]; then ko "$jour : la mensuelle d'il y a 11 mois ($ancien) a disparu"; manquantes=1; fi
  fi
  [ "$jour" = "$fin" ] && break
  jour="$(date -d "$jour + 1 day" +%F)"
  dow=$((dow % 7 + 1))
done
[ "$manquantes" = 0 ] && ok "aucune mensuelle encore valable n'a été supprimée en cours de route"

attendu_a="20240901-020000_quotidienne
20250101-020000_quotidienne
20251101-020000_quotidienne
20251201-020000_quotidienne
20260101-020000_quotidienne
20260201-020000_quotidienne
20260301-020000_quotidienne
20260401-020000_quotidienne
20260501-020000_quotidienne
20260601-020000_quotidienne
20260701-020000_quotidienne
20260801-020000_quotidienne
20260830-030000_hebdomadaire
20260901-020000_quotidienne
20260906-030000_hebdomadaire
20260913-030000_hebdomadaire
20260920-030000_hebdomadaire
20260927-030000_hebdomadaire
20261001-020000_quotidienne
20261004-030000_hebdomadaire
20261011-030000_hebdomadaire
20261016-020000_quotidienne
20261017-020000_quotidienne
20261018-020000_quotidienne
20261018-030000_hebdomadaire
20261019-020000_quotidienne
20261020-020000_quotidienne
20261021-020000_quotidienne
20261022-020000_quotidienne"
# 7 quotidiennes (16 au 22/10) + 8 hebdomadaires (dimanches 30/08 au 18/10) + 12 mensuelles (1er nov. 2025 … 1er oct. 2026)
# + 2 annuelles de plus (2024 : la toute première, 1er/09/2024 ; 2025 : 1er/01/2025 ; celle de 2026 est déjà la mensuelle de janvier) = 29.
verifier "au 2026-10-22 : 7 quotidiennes, 8 hebdomadaires, 12 mensuelles, annuelles 2024 et 2025" "$attendu_a" "$(liste "$A")"
verifier "la mensuelle d'octobre 2025 (13 mois) est expirée et supprimée" "absent" "$([ -d "$A/20251001-020000_quotidienne" ] && echo présent || echo absent)"
verifier "la mensuelle de septembre 2024 est gardée comme annuelle 2024 (10 ans)" "présent" "$([ -d "$A/20240901-020000_quotidienne" ] && echo présent || echo absent)"

# Idempotence : relancer sans nouvelle sauvegarde ne change rien.
rotation -d "$A" -n 2026-10-22
verifier "relancer la rotation ne change rien" "$attendu_a" "$(liste "$A")"

# Simulation : n'efface rien, annonce ce qu'elle supprimerait (une nouvelle quotidienne, le 23/10, pousse celle du 16/10 hors des 7 dernières).
jeu "$A" "20261023-020000_quotidienne"
avant_s="$(liste "$A")"
sortie_s="$(bash "$ROTATION" -d "$A" -n 2026-10-23 -s)"
verifier "simulation au 2026-10-23 : rien n'est supprimé" "$avant_s" "$(liste "$A")"
case "$sortie_s" in *"SUPPRIMER  20261016-020000_quotidienne  (simulation)"*) ok "la simulation annonce la sortie de la quotidienne du 16/10" ;; *) ko "la simulation devait annoncer la suppression de 20261016-020000_quotidienne : $sortie_s" ;; esac
rotation -d "$A" -n 2026-10-23
verifier "au 2026-10-23 : seule la quotidienne du 16/10 est supprimée" "$(printf '%s
' "$attendu_a" | grep -v '^20261016-020000_quotidienne$'; echo 20261023-020000_quotidienne)" "$(liste "$A")"

# ---------------------------------------------------------------------------------------------------------------------
echo "B. Annuelles : 10 ans, calculées sur les années civiles"
B="$TMP/b"
mkdir "$B"
for an in 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026; do
  jeu "$B" "${an}0101-020000_quotidienne"
  jeu "$B" "${an}0102-020000_quotidienne"
done
for j in 16 17 18 19 20 21 22; do jeu "$B" "202610${j}-020000_quotidienne"; done
rotation -d "$B" -n 2026-10-22
attendu_b="20170101-020000_quotidienne
20180101-020000_quotidienne
20190101-020000_quotidienne
20200101-020000_quotidienne
20210101-020000_quotidienne
20220101-020000_quotidienne
20230101-020000_quotidienne
20240101-020000_quotidienne
20250101-020000_quotidienne
20260101-020000_quotidienne
20261016-020000_quotidienne
20261017-020000_quotidienne
20261018-020000_quotidienne
20261019-020000_quotidienne
20261020-020000_quotidienne
20261021-020000_quotidienne
20261022-020000_quotidienne"
verifier "au 2026-10-22 : annuelles 2017 à 2026 (2016 et avant supprimées), les 2 janvier supprimés" "$attendu_b" "$(liste "$B")"

jeu "$B" "20270102-020000_quotidienne"
rotation -d "$B" -n 2027-01-05
attendu_b2="20180101-020000_quotidienne
20190101-020000_quotidienne
20200101-020000_quotidienne
20210101-020000_quotidienne
20220101-020000_quotidienne
20230101-020000_quotidienne
20240101-020000_quotidienne
20250101-020000_quotidienne
20260101-020000_quotidienne
20261016-020000_quotidienne
20261017-020000_quotidienne
20261018-020000_quotidienne
20261019-020000_quotidienne
20261020-020000_quotidienne
20261021-020000_quotidienne
20261022-020000_quotidienne
20270102-020000_quotidienne"
# 2017 sort (11 années civiles) ; la mensuelle d'octobre 2026 (la première, 16/10) reste ; la quotidienne du 16/10 aussi à ce titre.
# Les 7 dernières quotidiennes sont 20270102 et 22 à 17/10 ; le 16/10 reste comme première sauvegarde d'octobre 2026.
verifier "au 2027-01-05 : annuelle 2017 expirée, 2018 à 2026 et 2027 gardées" "$attendu_b2" "$(liste "$B")"

# ---------------------------------------------------------------------------------------------------------------------
echo "C. La rotation ne touche que les sauvegardes complètes qu'elle reconnaît"
C="$TMP/c"
mkdir -p "$C/dossier-autre" "$C/20200101-020000_quotidienne"                  # sans MANIFESTE.txt : pas une sauvegarde terminée
mkdir -p "$C/.en-cours-123" "$C/20200102-020000_inconnue"                    # sauvegarde en cours, type inconnu
: >"$C/notes.txt"
jeu "$C" "20150103-020000_quotidienne"                                        # une vraie, très ancienne (hors des 10 ans) : doit sortir
for j in 16 17 18 19 20 21 22; do jeu "$C" "202610${j}-020000_quotidienne"; done
rotation -d "$C" -n 2026-10-22
verifier "dossiers étrangers, incomplets ou en cours : intacts ; la vieille sauvegarde complète sort" \
  ".en-cours-123
20200101-020000_quotidienne
20200102-020000_inconnue
20261016-020000_quotidienne
20261017-020000_quotidienne
20261018-020000_quotidienne
20261019-020000_quotidienne
20261020-020000_quotidienne
20261021-020000_quotidienne
20261022-020000_quotidienne
dossier-autre
notes.txt" "$(liste "$C")"

# Paramètres invalides.
if bash "$ROTATION" -d "$C" -n "22/10/2026" >/dev/null 2>&1; then ko "une date au mauvais format devait être refusée"; else ok "date au mauvais format refusée"; fi
if bash "$ROTATION" -d "$TMP/inexistant" >/dev/null 2>&1; then ko "un dossier inexistant devait être refusé"; else ok "dossier inexistant refusé"; fi

echo
if [ "$echecs" = 0 ]; then echo "Rotation : tous les contrôles passent."; else echo "Rotation : $echecs contrôle(s) en échec."; exit 1; fi
