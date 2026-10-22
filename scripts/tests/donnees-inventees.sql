-- Données INVENTÉES pour l'essai de sauvegarde et de restauration (scripts/tests/sauvegarde-restauration.test.sh).
-- Aucune donnée réelle : noms, produit, numéros de police et de facture n'existent pas. Appliqué sur une pile jetable
-- (projet « sauvegarde-test »), après les migrations. Les documents émis sont ajoutés par le test, avec les vrais fichiers PDF.

insert into branches_principales (code, libelle) values ('ESSAI_PRINCIPALE', 'Branche principale d''essai') on conflict do nothing;
insert into branches (code, libelle, cree_par) values ('ESSAI', 'Branche d''essai', 'test-sauvegarde') on conflict do nothing;

insert into produits (code, libelle, gamme, branche, cree_par)
values ('ESSAIPROD', 'Produit d''essai', 'Gamme d''essai', 'ESSAI', 'test-sauvegarde');

insert into clients (type, nom, cree_par) values
  ('PERSONNE', 'Client Inventé Un', 'test-sauvegarde'),
  ('PERSONNE', 'Client Inventé Deux', 'test-sauvegarde'),
  ('ENTREPRISE', 'Société Inventée', 'test-sauvegarde');

insert into cotations (statut, produit_id, version_date_effet, souscripteur, date_effet, date_echeance, lignes, auteur_id, auteur_identifiant, modifie_le)
select 'BROUILLON', p.id, date '2026-01-01', '{"nom": "Client Inventé Un"}'::jsonb, date '2026-11-01', date '2027-10-31', '[]'::jsonb, 1, 'test-sauvegarde', now()
from produits p, generate_series(1, 3) as g where p.code = 'ESSAIPROD';

insert into polices (numero, cotation_id, produit_code, souscripteur, assures, risque, formules_retenues, donnees_calcul, resultat, ttc_total, echeancier, date_effet, date_echeance, cree_par)
select 'POL-2026-90000' || row_number() over (order by c.id), c.id, 'ESSAIPROD', '{"nom": "Client Inventé Un"}'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
       100000, '[]'::jsonb, date '2026-11-01', date '2027-10-31', 'test-sauvegarde'
from (select id from cotations order by id limit 2) c;

insert into factures (type, statut, police_id, produit_id, version_date_effet, date_effet, date_echeance, contenu, ttc, cree_par_id, cree_par)
select 'AFFAIRE_NOUVELLE', 'BROUILLON', po.id, p.id, date '2026-01-01', date '2026-11-01', date '2027-10-31', '{}'::jsonb, 100000, 1, 'test-sauvegarde'
from polices po, produits p where p.code = 'ESSAIPROD';

insert into modeles (type, code, libelle, cree_par) values ('COTATION', 'ESSAI-MODELE', 'Modèle d''essai', 'test-sauvegarde');
insert into modele_versions (modele_id, numero, statut, fichier, nom_fichier, taille, empreinte, commentaire, date_effet, "analyse", auteur_id, auteur_identifiant)
select m.id, 1, 'BROUILLON', '\x00'::bytea, 'essai.docx', 1, repeat('0', 64), 'version d''essai', date '2026-01-01', '{}'::jsonb, 1, 'test-sauvegarde'
from modeles m where m.code = 'ESSAI-MODELE';
