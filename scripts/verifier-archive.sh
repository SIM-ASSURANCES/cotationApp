#!/usr/bin/env bash
# Vérifie une archive produite par export-archive.sh : recalcule l'empreinte SHA-256 de chaque fichier du manifeste et signale
# tout écart. AUTONOME : bash et sha256sum suffisent (ni Docker, ni base de données) ; il est copié dans chaque archive,
# où il se lance sans argument.
#
#   ./verifier-archive.sh [-a DOSSIER_DE_L_ARCHIVE]     (défaut : le dossier où se trouve ce script)
#
# L'archive contient MANIFESTE.csv (numero,type,date_emission,chemin,empreinte_sha256) et documents/ (l'arborescence).
# Écarts signalés, un par ligne, puis un récapitulatif :
#   EMPREINTE DIFFÉRENTE  le fichier existe mais son SHA-256 n'est pas celui du manifeste (fichier modifié ou abîmé)
#   FICHIER ABSENT        le manifeste cite un fichier qui n'est pas dans documents/
#   NON LISTÉ             un fichier de documents/ n'est pas dans le manifeste
#   LIGNE INVALIDE        ligne du manifeste illisible, chemin non conforme ou empreinte qui n'a pas 64 caractères hexadécimaux
#   DOUBLON               le même chemin figure deux fois au manifeste
# Codes de sortie : 0 aucun écart ; 2 au moins un écart ; 1 erreur d'utilisation (archive illisible, outil manquant).
set -Eeuo pipefail
export LC_ALL=C

erreur() { printf 'verifier-archive : %s\n' "$*" >&2; exit 1; }

ARCHIVE=""
while getopts ":a:" option; do
  case "$option" in
    a) ARCHIVE="$OPTARG" ;;
    *) erreur "usage : $0 [-a DOSSIER_DE_L_ARCHIVE]" ;;
  esac
done
[ -n "$ARCHIVE" ] || ARCHIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v sha256sum >/dev/null 2>&1 || erreur "sha256sum introuvable."
MANIFESTE="$ARCHIVE/MANIFESTE.csv"
RACINE="$ARCHIVE/documents"
[ -f "$MANIFESTE" ] || erreur "MANIFESTE.csv introuvable dans $ARCHIVE."
[ -d "$RACINE" ] || erreur "dossier documents/ introuvable dans $ARCHIVE."

ENTETE="numero,type,date_emission,chemin,empreinte_sha256"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LISTE="$TMP/a-verifier"      # « empreinte  chemin » : entrée de sha256sum -c
CITES="$TMP/cites"           # chemins du manifeste, triés
: >"$LISTE"
: >"$CITES"

ecarts=0
ecart() { printf '%s  %s\n' "$1" "$2"; ecarts=$((ecarts + 1)); }

premiere="$(head -n 1 "$MANIFESTE" | tr -d '\r\357\273\277')"
[ "$premiere" = "$ENTETE" ] || erreur "en-tête du manifeste inattendu : « $premiere » (attendu : « $ENTETE »)."

lignes=0
while IFS=, read -r numero type date chemin empreinte; do
  lignes=$((lignes + 1))
  numero_ligne=$((lignes + 1))
  # Un chemin est une suite de segments sûrs séparés par « / » : jamais de « .. », de « / » initial, d'espace ni de virgule.
  if [[ ! "$chemin" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$ ]]; then
    ecart "LIGNE INVALIDE" "ligne $numero_ligne du manifeste : chemin non conforme « $chemin »"
    continue
  fi
  if [[ ! "$empreinte" =~ ^[0-9a-f]{64}$ ]]; then
    ecart "LIGNE INVALIDE" "ligne $numero_ligne ($chemin) : empreinte qui n'a pas 64 caractères hexadécimaux"
    continue
  fi
  printf '%s\n' "$chemin" >>"$CITES"
  printf '%s  %s\n' "$empreinte" "$chemin" >>"$LISTE"
done < <(tail -n +2 "$MANIFESTE" | tr -d '\r' | grep -v '^$' || true)

sort "$CITES" >"$CITES.tri"
doublons="$(uniq -d "$CITES.tri" || true)"
if [ -n "$doublons" ]; then
  while IFS= read -r chemin; do ecart "DOUBLON" "$chemin figure plusieurs fois au manifeste"; done <<<"$doublons"
fi

verifies="$(wc -l <"$LISTE" | tr -d ' ')"
if [ "$verifies" -gt 0 ]; then
  # Une seule passe : sha256sum recalcule chaque empreinte ; seuls les échecs sont écrits.
  sortie="$(cd "$RACINE" && sha256sum -c --quiet "$LISTE" 2>&1 || true)"
  while IFS= read -r ligne; do
    case "$ligne" in
      *": FAILED open or read") ecart "FICHIER ABSENT" "${ligne%: FAILED open or read}" ;;
      *": FAILED") ecart "EMPREINTE DIFFÉRENTE" "${ligne%: FAILED}" ;;
    esac
  done <<<"$sortie"
fi

# Fichiers de documents/ que le manifeste ne cite pas (les fichiers provisoires « .ecriture-* » du générateur sont ignorés).
( cd "$RACINE" && find . -type f ! -name '.ecriture-*' | sed 's|^\./||' | sort ) >"$TMP/presents"
while IFS= read -r chemin; do
  [ -n "$chemin" ] && ecart "NON LISTÉ" "$chemin"
done < <(comm -13 "$CITES.tri" "$TMP/presents")

echo
if [ "$ecarts" = 0 ]; then
  echo "Archive conforme : $verifies fichier(s) vérifié(s), aucun écart."
  [ "$verifies" -gt 0 ] || echo "(le manifeste ne cite aucun fichier)"
  exit 0
fi
echo "ARCHIVE NON CONFORME : $ecarts écart(s) sur $verifies fichier(s) cité(s) au manifeste."
exit 2
