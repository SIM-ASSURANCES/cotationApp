-- Index demandés par l'audit du 13/10/2026 (m8) : filtres et tris des tableaux de bord et des documents d'une cotation.
-- Ajout seul, sans risque : aucune donnée n'est touchée.

CREATE INDEX "cotations_auteur_identifiant_idx" ON "cotations"("auteur_identifiant");
CREATE INDEX "cotations_cree_le_idx" ON "cotations"("cree_le");
CREATE INDEX "cotations_emise_le_idx" ON "cotations"("emise_le");
CREATE INDEX "cotations_acceptee_le_idx" ON "cotations"("acceptee_le");
CREATE INDEX "documents_emis_cotation_id_idx" ON "documents_emis"("cotation_id");
CREATE INDEX "factures_date_emission_idx" ON "factures"("date_emission");
CREATE INDEX "paiements_date_idx" ON "paiements"("date");
