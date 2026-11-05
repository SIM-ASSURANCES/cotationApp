-- D64 : durée du contrat imposée par version de produit (1 an, sans prorata). Les versions existantes gardent leur comportement (faux).
ALTER TABLE "produit_versions" ADD COLUMN "duree_imposee_un_an" BOOLEAN NOT NULL DEFAULT false;

-- Une durée imposée exclut le prorata : le coefficient vaut 1. Garde de la base, en plus du contrôle de la saisie.
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_duree_imposee_sans_prorata" CHECK (NOT "duree_imposee_un_an" OR NOT "prorata_actif");
