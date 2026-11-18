# syntax=docker/dockerfile:1
# Image du générateur : FastAPI + LibreOffice sans interface + polices des modèles Word.
# Base Debian (trixie). Contexte de construction : le dossier generateur/ (voir docker-compose.yml).
FROM python:3.14-slim-trixie

# LibreOffice (Writer seulement, sans interface graphique) et polices LIBRES (D69) :
#   - Carlito : métriquement compatible avec Calibri ; Liberation : avec Arial et Times New Roman ; fontconfig les y résout lui-même
#     (30-metric-aliases) : aucune police Microsoft n'est à fournir pour Calibri, Arial ni Times New Roman ;
#   - DejaVu : polices de secours (aux dimensions différentes : ce n'est PAS un remplaçant, voir app/polices.py) ;
#   - fontconfig : gestion des polices.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      fontconfig \
      fonts-crosextra-carlito \
      fonts-liberation \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Tahoma : pas de police libre ADOPTÉE. Elle est fournie par SIM dans polices/ (ci-dessous), et /sante l'exige. ESSAI (D69) : avec
# TAHOMA_LIBRE=oui, l'image ajoute la police de remplacement du projet Wine (paquet fonts-wine, LGPL-2.1+), exposée à fontconfig sous
# le nom « Wine Tahoma » (fontconfig/tahoma-wine.conf), seulement si aucune vraie Tahoma n'est là. La mesure du 06/10/2026 (recette.md §1.2,
# variante C') avait trouvé que sa pagination s'écartait de Word : on ne l'adopte (défaut « oui ») qu'après le test de fidélité de la recette.
# Seuls tahoma.ttf et tahomabd.ttf sont exposés, par des liens (fonts-wine range aussi Marlett, Wingdings…, dont on n'a pas besoin) ;
# `test -f` fait échouer la construction si le paquet change d'emplacement.
ARG TAHOMA_LIBRE=non
COPY fontconfig/ /tmp/fontconfig/
RUN if [ "$TAHOMA_LIBRE" = "oui" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends fonts-wine \
      && rm -rf /var/lib/apt/lists/* \
      && test -f /usr/share/wine/fonts/tahoma.ttf && test -f /usr/share/wine/fonts/tahomabd.ttf \
      && mkdir -p /usr/local/share/fonts/wine \
      && ln -s /usr/share/wine/fonts/tahoma.ttf /usr/local/share/fonts/wine/tahoma.ttf \
      && ln -s /usr/share/wine/fonts/tahomabd.ttf /usr/local/share/fonts/wine/tahomabd.ttf \
      && cp /tmp/fontconfig/tahoma-wine.conf /etc/fonts/conf.d/60-tahoma-wine.conf; \
    fi \
 && rm -rf /tmp/fontconfig

# Polices sous licence que SIM fournit (Tahoma) ou veut imposer (dossier ignoré par Git, voir polices/README.md). Absent ou vide : l'image
# fonctionne avec les polices libres ci-dessus ; /sante dit alors que Tahoma manque (sauf essai TAHOMA_LIBRE=oui).
COPY polices/ /usr/local/share/fonts/sim/
RUN fc-cache -f \
 && echo "Polices installées :" && fc-list : family | sort -u \
 && echo "Résolution des polices des modèles (fc-match) :" \
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
