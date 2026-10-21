-- Étape 3 (20/10/2026) : Seuil unique de validation pour tous les produits (10 000 000 FCFA TTC)
-- et habilitation des valideurs Technique et Direction Générale (fin de l'écart D21).

-- 1. Seuil de validation global par défaut (10 000 000 FCFA TTC au 01/01/2026).
INSERT INTO "parametres" ("cle", "valeur", "date_effet", "cree_par")
VALUES ('seuil_validation_global', '10000000', '2026-01-01', 'migration')
ON CONFLICT ("cle", "date_effet") DO NOTHING;

-- 2. Habilitation de la Direction Générale comme valideur (fin de l'écart D21) :
--    - VALIDER_COTATION passe à 'VALIDE'
--    - EMETTRE_CONTRAT passe à 'VALIDE' (validation de contrat H44)
--    - EMETTRE_FACTURE passe à 'VALIDE' (validation de facture H56)

INSERT INTO "journal_audit" ("utilisateur_identifiant", "action", "objet_type", "objet_id", "avant", "apres")
SELECT 'migration', 'DROIT_MODIFIE', 'profil', 'DIRECTION_GENERALE',
       jsonb_build_object('action', d."action", 'niveau', d."niveau"),
       jsonb_build_object('action', d."action", 'niveau', 'VALIDE')
FROM "profils_droits" d
JOIN "profils" p ON p."id" = d."profil_id"
WHERE p."code" = 'DIRECTION_GENERALE'
  AND d."action" IN ('VALIDER_COTATION', 'EMETTRE_CONTRAT', 'EMETTRE_FACTURE')
  AND d."niveau" <> 'VALIDE';

INSERT INTO "profils_droits" ("profil_id", "action", "niveau")
SELECT p."id", a."action", 'VALIDE'
FROM "profils" p
CROSS JOIN (VALUES ('VALIDER_COTATION'), ('EMETTRE_CONTRAT'), ('EMETTRE_FACTURE')) AS a("action")
WHERE p."code" = 'DIRECTION_GENERALE'
ON CONFLICT ("profil_id", "action") DO UPDATE SET "niveau" = 'VALIDE';
