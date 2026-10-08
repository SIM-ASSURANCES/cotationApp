-- Corrections de la 4a demandées le 08/10/2026 (D21, D22) :
--  1. validation de l'émission d'un contrat au-dessus du seuil du produit (CDC §4 « Oui (sous seuil) », §4.1) ;
--  2. la valeur de droit « Proposition » disparaît : elle devient « Lecture » (D21).
-- (L'horodatage de cette migration suit celui de la migration précédente, qu'on ne renomme pas.)

-- CreateTable
CREATE TABLE "validations_contrat" (
    "id" SERIAL NOT NULL,
    "police_id" INTEGER NOT NULL,
    "ttc" DECIMAL(18,2) NOT NULL,
    "seuil" DECIMAL(18,6) NOT NULL,
    "statut" TEXT NOT NULL,
    "demande_par_id" INTEGER NOT NULL,
    "demande_par_identifiant" TEXT NOT NULL,
    "demande_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valide_par_id" INTEGER,
    "valide_par_identifiant" TEXT,
    "valide_le" TIMESTAMP(3),

    CONSTRAINT "validations_contrat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "validations_contrat_statut_valide" CHECK ("statut" IN ('A_VALIDER', 'VALIDEE')),
    -- Une demande validée dit par qui et quand ; une demande ouverte ne le dit pas.
    CONSTRAINT "validations_contrat_decision_coherente" CHECK (
        ("statut" = 'A_VALIDER' AND "valide_par_id" IS NULL AND "valide_le" IS NULL)
        OR ("statut" = 'VALIDEE' AND "valide_par_id" IS NOT NULL AND "valide_le" IS NOT NULL)
    )
);

-- CreateIndex
CREATE INDEX "validations_contrat_police_id_idx" ON "validations_contrat"("police_id");

-- Une seule demande ouverte par police.
CREATE UNIQUE INDEX "validations_contrat_une_ouverte" ON "validations_contrat"("police_id") WHERE "statut" = 'A_VALIDER';

-- AddForeignKey
ALTER TABLE "validations_contrat" ADD CONSTRAINT "validations_contrat_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une demande ne se supprime pas, et seule sa décision (A_VALIDER vers VALIDEE) peut la modifier.
CREATE FUNCTION validations_contrat_protegees() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'validation de contrat : suppression interdite';
    END IF;
    IF OLD."statut" <> 'A_VALIDER' THEN
        RAISE EXCEPTION 'validation de contrat déjà décidée : modification interdite';
    END IF;
    IF NEW."police_id" <> OLD."police_id" OR NEW."ttc" <> OLD."ttc" OR NEW."seuil" <> OLD."seuil"
       OR NEW."demande_par_id" <> OLD."demande_par_id" OR NEW."demande_le" <> OLD."demande_le" THEN
        RAISE EXCEPTION 'validation de contrat : seule la décision peut être renseignée';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validations_contrat_protegees BEFORE UPDATE OR DELETE ON "validations_contrat"
    FOR EACH ROW EXECUTE FUNCTION validations_contrat_protegees();

-- Le niveau « Proposition » n'existe plus (D21) : les droits déjà enregistrés passent en « Lecture », avec une trace
-- dans le journal d'audit (ajout seul, écrit ici par la migration).
INSERT INTO "journal_audit" ("utilisateur_identifiant", "action", "objet_type", "objet_id", "avant", "apres")
SELECT 'migration', 'DROIT_MODIFIE', 'profil', p."code",
       jsonb_build_object('action', d."action", 'niveau', 'PROPOSITION'),
       jsonb_build_object('action', d."action", 'niveau', 'LECTURE')
FROM "profils_droits" d JOIN "profils" p ON p."id" = d."profil_id"
WHERE d."niveau" = 'PROPOSITION';

UPDATE "profils_droits" SET "niveau" = 'LECTURE' WHERE "niveau" = 'PROPOSITION';
