-- Étape 6 (22/10/2026, D42) : conditions générales par branche principale.
-- Une CG par branche, historisée par date d'effet (jamais modifiée : une nouvelle CG est une nouvelle ligne datée).
-- Le visa n'est plus saisi : il est lu dans la version publiée du modèle. Les colonnes cg_modele_code et cg_visa de
-- produit_versions sont conservées pour l'historique mais ne sont plus lues. Les CS restent propres au produit.

CREATE TABLE "branche_cg" (
    "id" SERIAL NOT NULL,
    "branche_principale" TEXT NOT NULL,
    "modele_code" TEXT NOT NULL,
    "date_effet" DATE NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "branche_cg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branche_cg_branche_principale_date_effet_key" ON "branche_cg"("branche_principale", "date_effet");

ALTER TABLE "branche_cg" ADD CONSTRAINT "branche_cg_branche_principale_fkey" FOREIGN KEY ("branche_principale") REFERENCES "branches_principales"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "branche_cg" ADD CONSTRAINT "branche_cg_modele_code_fkey" FOREIGN KEY ("modele_code") REFERENCES "modeles"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Historique du paramétrage : une ligne en vigueur ne se modifie ni ne se supprime (fonction de la migration parametrage_produits).
CREATE TRIGGER branche_cg_historisee BEFORE UPDATE OR DELETE ON "branche_cg"
  FOR EACH ROW EXECUTE FUNCTION parametrage_historise();

-- Reprise de l'existant : une branche reçoit la CG que ses produits citent déjà SI, et seulement si, la dernière version de
-- chacun de ses produits cite le même modèle de CG (type CG, existant). Sinon la branche reste vide : la Technique la renseigne
-- (écran « Conditions générales »). Jamais de choix deviné.
WITH derniere AS (
    SELECT DISTINCT ON (v."produit_id") v."produit_id", p."branche_principale" AS branche, v."cg_modele_code" AS code
    FROM "produit_versions" v
    JOIN "produits" p ON p."id" = v."produit_id"
    WHERE p."branche_principale" IS NOT NULL
    ORDER BY v."produit_id", v."date_effet" DESC
), uniforme AS (
    SELECT branche, MIN(code) AS code
    FROM derniere
    GROUP BY branche
    HAVING COUNT(*) = COUNT(code) AND COUNT(DISTINCT code) = 1
), repris AS (
    INSERT INTO "branche_cg" ("branche_principale", "modele_code", "date_effet", "cree_par")
    SELECT u.branche, u.code, DATE '2026-01-01', 'migration'
    FROM uniforme u
    JOIN "modeles" m ON m."code" = u.code AND m."type" = 'CG'
    RETURNING "branche_principale", "modele_code", "date_effet"
)
INSERT INTO "journal_audit" ("utilisateur_identifiant", "action", "objet_type", "objet_id", "avant", "apres")
SELECT 'migration', 'PARAMETRE_MODIFIE', 'branche_cg', r."branche_principale", NULL,
       jsonb_build_object('branchePrincipale', r."branche_principale", 'modeleCode', r."modele_code", 'dateEffet', r."date_effet", 'source', 'reprise de l''existant (étape 6)')
FROM repris r;
