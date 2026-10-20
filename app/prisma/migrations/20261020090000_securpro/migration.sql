-- Session SECURPRO (D37, H105) : référentiel des 5 branches principales et rattachement des produits.
-- Un code de branche principale ne change plus une fois en production et ne peut pas être supprimé.
-- La colonne branche_principale sur produits est facultative en base pour ne pas deviner la branche des produits existants,
-- mais obligatoire à la saisie (création et modification d'un produit).

CREATE TABLE "branches_principales" (
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_principales_pkey" PRIMARY KEY ("code")
);

CREATE OR REPLACE FUNCTION branches_principales_code_immuable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Suppression interdite sur branches_principales (code %).', OLD.code;
    END IF;
    IF NEW.code <> OLD.code THEN
        RAISE EXCEPTION 'Le code d''une branche principale ne peut pas être modifié (% -> %).', OLD.code, NEW.code;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER branches_principales_sans_modification_code
BEFORE UPDATE OR DELETE ON "branches_principales"
FOR EACH ROW EXECUTE FUNCTION branches_principales_code_immuable();

INSERT INTO "branches_principales" ("code", "libelle") VALUES
    ('MALADIE', 'Maladie'),
    ('ACCIDENTS_CORPORELS', 'Accidents corporels'),
    ('RECOLTE', 'Récolte'),
    ('DECES', 'Décès'),
    ('INCENDIE_DOMMAGES', 'Incendie et dommages aux biens')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "produits" ADD COLUMN "branche_principale" TEXT;

ALTER TABLE "produits" ADD CONSTRAINT "produits_branche_principale_fkey"
    FOREIGN KEY ("branche_principale") REFERENCES "branches_principales"("code")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

