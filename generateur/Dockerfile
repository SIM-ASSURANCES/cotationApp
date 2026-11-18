# syntax=docker/dockerfile:1
# Image du générateur : FastAPI + LibreOffice sans interface + polices des modèles Word.
# Base Debian (trixie). Contexte de construction : le dossier generateur/ (voir docker-compose.yml).
FROM python:3.14-slim-trixie

# LibreOffice (Writer seulement, sans interface graphique) et polices LIBRES (D69) : aucune police Microsoft n'est nécessaire.
#   - Carlito : métriquement compatible avec Calibri ; Liberation : avec Arial et Times New Roman ;
#   - fonts-wine : la police de remplacement du projet Wine pour Tahoma (famille « Tahoma », licence LGPL-2.1+), de mêmes
#     dimensions de caractères : les retours à la ligne, donc les sauts de page, sont ceux de Word ;
#   - DejaVu : polices de secours (aux dimensions différentes : ce n'est PAS un remplaçant, voir app/polices.py) ;
#   - fontconfig : gestion des polices ; il résout Calibri en Carlito, Arial et Times New Roman en Liberation (30-metric-aliases).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      fontconfig \
      fonts-crosextra-carlito \
      fonts-liberation \
      fonts-wine \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# fonts-wine range ses polices dans /usr/share/wine/fonts, hors des dossiers de fontconfig, avec d'autres polices dont on n'a pas
# besoin (Marlett, Wingdings…) : on n'expose à fontconfig que les deux fichiers Tahoma (normale et gras), par des liens.
# `test -f` fait échouer la construction si le paquet change d'emplacement : mieux vaut cela qu'une image sans Tahoma.
RUN mkdir -p /usr/local/share/fonts/wine \
 && test -f /usr/share/wine/fonts/tahoma.ttf && test -f /usr/share/wine/fonts/tahomabd.ttf \
 && ln -s /usr/share/wine/fonts/tahoma.ttf /usr/local/share/fonts/wine/tahoma.ttf \
 && ln -s /usr/share/wine/fonts/tahomabd.ttf /usr/local/share/fonts/wine/tahomabd.ttf

# Polices facultatives, sous licence, que SIM fournirait (dossier ignoré par Git, voir polices/README.md). Absent ou vide : l'image
# fonctionne avec les polices libres ci-dessus.
COPY polices/ /usr/local/share/fonts/sim/
RUN fc-cache -f \
 && echo "Polices installées :" && fc-list : family | sort -u \
 && echo "Résolution des polices des modèles :" \
 && for police in Tahoma Calibri Arial "Times New Roman"; do echo "  $police -> $(fc-match -f '%{family}' "$police")"; done

# Utilisateur sans privilèges ; /donnees reçoit les documents émis et le profil LibreOffice
# (volume persistant, voir docker-compose.yml).
RUN useradd --create-home --uid 10001 generateur \
 && mkdir -p /donnees/sortie /donnees/profil-libreoffice \
 && chown -R generateur:generateur /donnees

WORKDIR /srv/generateur
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts

ENV PYTHONUTF8=1 \
    PYTHONUNBUFFERED=1 \
    LIBREOFFICE_CHEMIN=/usr/bin/soffice \
    DOSSIER_SORTIE=/donnees/sortie \
    PROFIL_LIBREOFFICE=/donnees/profil-libreoffice \
    GENERATEUR_HOTE=0.0.0.0 \
    GENERATEUR_PORT=8001
# GENERATEUR_SECRET : fourni à l'exécution (docker-compose.yml), jamais dans l'image.
# 0.0.0.0 vaut dans le réseau privé de Docker uniquement : aucun port n'est publié sur l'hôte.

USER generateur
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/sante', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "app"]
