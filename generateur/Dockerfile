# syntax=docker/dockerfile:1
# Image du générateur : FastAPI + LibreOffice sans interface + polices des modèles Word.
# Base Debian (trixie). Contexte de construction : le dossier generateur/ (voir docker-compose.yml).
FROM python:3.14-slim-trixie

# LibreOffice (Writer seulement, sans interface graphique) et polices libres :
#   - Carlito : métriquement compatible avec Calibri ; Liberation : avec Arial et Times New Roman ;
#   - DejaVu : polices de secours ; fontconfig : gestion des polices.
# Tahoma, Segoe UI, etc. n'ont pas d'équivalent libre : elles viennent de polices/ (ci-dessous).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      fontconfig \
      fonts-crosextra-carlito \
      fonts-liberation \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Polices fournies par Thierry (dossier ignoré par Git, voir polices/README.md).
COPY polices/ /usr/local/share/fonts/sim/
RUN fc-cache -f \
 && echo "Polices installées :" && fc-list : family | sort -u

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
