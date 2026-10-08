-- Branches fiscales paramétrables (D21, réponse de Thierry du 08/10/2026) : la liste n'est plus figée.
-- Clé des taux de taxe et des produits. Le code ne change jamais et une branche ne se supprime pas
-- (on la désactive) ; le libellé et l'état actif se modifient, modifications journalisées par l'application.

CREATE TABLE "branches" (
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "branches_code_valide" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_]{0,29}$'),
    CONSTRAINT "branches_libelle_present" CHECK (length(btrim("libelle")) BETWEEN 1 AND 100)
);

-- Les branches déjà utilisées par un taux ou un produit sont reprises telles quelles (libellé = code,
-- à renommer depuis l'écran), pour que les clés étrangères ci-dessous soient valides.
INSERT INTO "branches" ("code", "libelle", "cree_par")
SELECT DISTINCT b, b, 'migration' FROM (
    SELECT "branche" AS b FROM "taxes"
    UNION SELECT "branche" FROM "produits"
) existantes
ON CONFLICT DO NOTHING;

ALTER TABLE "taxes" ADD CONSTRAINT "taxes_branche_fkey" FOREIGN KEY ("branche") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "produits" ADD CONSTRAINT "produits_branche_fkey" FOREIGN KEY ("branche") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION branche_stable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'branche fiscale : suppression interdite, désactivez-la';
    END IF;
    IF NEW."code" <> OLD."code" OR NEW."cree_le" <> OLD."cree_le" OR NEW."cree_par" <> OLD."cree_par" THEN
        RAISE EXCEPTION 'branche fiscale : seuls le libellé et l''état actif se modifient';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branches_stables"
BEFORE UPDATE OR DELETE ON "branches"
FOR EACH ROW EXECUTE FUNCTION branche_stable();
