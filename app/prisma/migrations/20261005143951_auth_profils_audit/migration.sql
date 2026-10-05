-- CreateTable
CREATE TABLE "profils" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,

    CONSTRAINT "profils_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profils_droits" (
    "profil_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,

    CONSTRAINT "profils_droits_pkey" PRIMARY KEY ("profil_id","action")
);

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" SERIAL NOT NULL,
    "identifiant" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "mot_de_passe_hash" TEXT NOT NULL,
    "profil_id" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "doit_changer_mot_de_passe" BOOLEAN NOT NULL DEFAULT false,
    "echecs_consecutifs" INTEGER NOT NULL DEFAULT 0,
    "verrouille_jusqua" TIMESTAMP(3),
    "derniere_connexion_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_audit" (
    "id" BIGSERIAL NOT NULL,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateur_id" INTEGER,
    "utilisateur_identifiant" TEXT,
    "action" TEXT NOT NULL,
    "objet_type" TEXT,
    "objet_id" TEXT,
    "avant" JSONB,
    "apres" JSONB,
    "adresse_ip" TEXT,

    CONSTRAINT "journal_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profils_code_key" ON "profils"("code");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_identifiant_key" ON "utilisateurs"("identifiant");

-- CreateIndex
CREATE INDEX "journal_audit_horodatage_idx" ON "journal_audit"("horodatage");

-- CreateIndex
CREATE INDEX "journal_audit_action_idx" ON "journal_audit"("action");

-- CreateIndex
CREATE INDEX "journal_audit_utilisateur_id_idx" ON "journal_audit"("utilisateur_id");

-- AddForeignKey
ALTER TABLE "profils_droits" ADD CONSTRAINT "profils_droits_profil_id_fkey" FOREIGN KEY ("profil_id") REFERENCES "profils"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_profil_id_fkey" FOREIGN KEY ("profil_id") REFERENCES "profils"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Journal d'audit en AJOUT SEUL (CDC §15.4) : toute modification ou suppression est refusée
-- par la base elle-même, quel que soit le code qui s'exécute.
CREATE FUNCTION journal_audit_ajout_seul() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal_audit est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER journal_audit_sans_modification
  BEFORE UPDATE OR DELETE ON "journal_audit"
  FOR EACH ROW EXECUTE FUNCTION journal_audit_ajout_seul();

CREATE TRIGGER journal_audit_sans_vidage
  BEFORE TRUNCATE ON "journal_audit"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_audit_ajout_seul();
