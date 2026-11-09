-- D66 (09/11/2026) : une version naît AU BARÈME, « en préparation », sans passer par le mode « Par garanties ».
-- Horodatage postérieur à 20261104100000 (dernière migration) : test src/serveur/migrations.test.ts.
--
-- Une version en mode BAREME dont le barème n'est pas publié est « en préparation » : l'application ne la retient nulle part (la version
-- précédente continue de servir). Aucune colonne n'est ajoutée : l'état se déduit du mode BAREME et de l'absence de barème publié, donc
-- il ne peut pas se désynchroniser du barème. La publication (code) la fait entrer en vigueur ; pour « dès la publication », elle remplace la date
-- d'effet provisoire 9999-12-31 par la date du jour, ce que le déclencheur d'historisation permet tant que l'ancienne date est future.
--
-- Déclencheur modifié : produit_versions_bareme_publie.
--  Avant : le mode BAREME n'était admis, à l'insertion comme à la bascule, que si le barème de la version était déjà publié.
--  Après : une INSERTION en mode BAREME est admise (version en préparation) ; la BASCULE d'une version existante vers BAREME exige
--          toujours un barème publié (versions provisoires « Par garanties » d'avant D66, H140, D50).
--  Raison : une version ne peut plus naître « Par garanties » pour recevoir un barème ; elle doit naître au barème, avant que son barème existe
--           (un barème ne se rattache qu'à une version en mode BAREME : déclencheur bareme_documents_creation, inchangé).
--  Sûreté : une version BAREME sans barème publié ne produit jamais de montant (lireBaremePublie refuse), et le code l'écarte de la
--           recherche de la version en vigueur. Les déclencheurs « barème publié ne se modifie ni ne se supprime » sont inchangés.

CREATE OR REPLACE FUNCTION produit_versions_bareme_publie() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.mode_tarification = 'BAREME' AND OLD.mode_tarification IS DISTINCT FROM 'BAREME' THEN
    IF NOT EXISTS (SELECT 1 FROM bareme_documents WHERE version_id = NEW.id AND statut = 'PUBLIE') THEN
      RAISE EXCEPTION 'barème : une version existante ne passe au mode BAREME que si son barème est publié (publiez le barème, puis basculez)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
