import { codeValeur } from "./contexte";
import { problemesTranches } from "./tranches";
import type { Probleme } from "./erreurs";
import { DECIMAL, OPERATIONS, type Bareme, type Champ, type ConditionAffichage, type Operande } from "./schema";

const PROFONDEUR_MAX = 2;

const estNumerique = (c: Champ): boolean => c.type === "MONTANT" || c.type === "NOMBRE" || (c.type === "LISTE" && c.numerique === true);

/**
 * Contrôles d'intégrité d'un barème déjà lu par le schéma : références (champ supprimé encore lu par un sous-jacent), tables
 * complètes, valeurs intermédiaires sans cycle ni référence en avant, assiettes de profondeur 2 au plus, taux d'une composante
 * fourni par exactement un sous-jacent E1. `publication` : exige aussi au moins un jeu d'essai (décision 9).
 */
export function verifierBareme(b: Bareme, options: { publication?: boolean } = {}): Probleme[] {
  const p: Probleme[] = [];
  const ajoute = (code: string, message: string) => p.push({ code, message });

  const champs = new Map(b.champs.map((c) => [c.code, c]));
  const tables = new Map(b.tables.map((t) => [t.code, t]));
  const garanties = new Map(b.garanties.map((g) => [g.code, g]));
  const blocs = new Set(b.blocs.map((x) => x.code));

  const doublons = (genre: string, codes: string[]) => {
    for (const c of new Set(codes.filter((x, i) => codes.indexOf(x) !== i))) ajoute("CODE_EN_DOUBLE", `${genre} « ${c} » : ce code est utilisé plusieurs fois. Donnez à chacun un code différent.`);
  };
  doublons("Champ ou valeur intermédiaire", [...b.champs.map((c) => c.code), ...b.intermediaires.map((i) => i.code)]);
  doublons("Table", b.tables.map((t) => t.code));
  doublons("Sous-jacent", b.sousJacents.map((s) => s.code));
  doublons("Garantie", b.garanties.map((g) => g.code));
  for (const g of b.garanties) doublons(`Composante de « ${g.code} »`, g.composantes.map((c) => c.code));

  const referenceSouscrite = (ref: string): boolean => {
    const [g, c] = ref.split(".");
    const garantie = garanties.get(g);
    return garantie !== undefined && (c === undefined || garantie.composantes.some((x) => x.code === c));
  };
  const verifierCondition = (si: ConditionAffichage, ou: string) => {
    if ("souscrit" in si) {
      if (!referenceSouscrite(si.souscrit)) ajoute("REFERENCE_INCONNUE", `${ou} : la garantie « ${si.souscrit} » n'existe pas. Choisissez une garantie ou une composante existante (onglet Garanties), ou retirez cette condition.`);
    } else if (!champs.has(si.champ)) ajoute("REFERENCE_INCONNUE", `${ou} : le champ « ${si.champ} » n'existe pas. Choisissez un champ de la liste (onglet Champs), ou créez-le d'abord.`);
  };

  // Champs
  for (const c of b.champs) {
    const ou = `Champ « ${c.code} »`;
    if ((c.type === "LISTE" || c.type === "CHOIX_MULTIPLES") && (c.valeurs ?? []).length === 0) ajoute("LISTE_VIDE", `${ou} : une liste doit avoir des valeurs. Ajoutez au moins une valeur, ou changez le type du champ.`);
    if (c.valeurs !== undefined) {
      doublons(`${ou}, valeur`, c.valeurs.map(codeValeur));
      if (c.numerique && c.valeurs.some((v) => !DECIMAL.test(codeValeur(v)))) ajoute("LISTE_NON_NUMERIQUE", `${ou} : une liste de montants ne peut contenir que des nombres. Corrigez les valeurs en nombres, ou changez le type du champ.`);
    }
    if (c.min !== undefined && c.max !== undefined && Number(c.min) > Number(c.max)) ajoute("BORNES", `${ou} : le minimum dépasse le maximum. Inversez-les, ou corrigez l'une des deux bornes.`);
    if (c.bloc !== undefined && blocs.size > 0 && !blocs.has(c.bloc)) ajoute("REFERENCE_INCONNUE", `${ou} : le bloc « ${c.bloc} » n'existe pas. Choisissez un bloc existant, ou retirez le bloc de ce champ.`);
    if (c.si) verifierCondition(c.si, ou);
  }
  // Conditions d'affichage sans cycle
  const visite = new Set<string>();
  const parcours = (code: string, chemin: string[]) => {
    if (chemin.includes(code)) return ajoute("CYCLE", `Les conditions d'affichage des champs « ${[...chemin, code].join(" → ")} » forment un cycle. Retirez la condition d'un de ces champs pour rompre la boucle.`);
    if (visite.has(code)) return;
    const si = champs.get(code)?.si;
    if (si && "champ" in si) parcours(si.champ, [...chemin, code]);
    visite.add(code);
  };
  for (const c of b.champs) parcours(c.code, []);

  // Assiettes : références, arités, profondeur
  const verifierOperande = (op: Operande, ou: string, autorises: Set<string>): number => {
    if (typeof op === "string") {
      if (DECIMAL.test(op) || autorises.has(op)) return 0;
      const c = champs.get(op);
      if (c) {
        if (!estNumerique(c)) ajoute("CHAMP_NON_NUMERIQUE", `${ou} : le champ « ${op} » n'est pas un nombre. Choisissez un champ numérique (nombre, montant ou liste de montants).`);
      } else if (b.intermediaires.some((i) => i.code === op)) ajoute("REFERENCE_EN_AVANT", `${ou} : la valeur intermédiaire « ${op} » est définie plus bas ou se lit elle-même. Placez la valeur intermédiaire avant celle qui la lit (onglet Intermédiaires), sans qu'elle se lise elle-même.`);
      else ajoute("REFERENCE_INCONNUE", `${ou} : « ${op} » n'est ni un champ ni une valeur intermédiaire. Choisissez un champ ou une valeur intermédiaire existants, ou créez-le d'abord.`);
      return 0;
    }
    if (!Array.isArray(op)) return 0;
    const [tete, ...args] = op;
    if (typeof tete !== "string" || !(OPERATIONS as readonly string[]).includes(tete)) {
      ajoute("OPERATION_INCONNUE", `${ou} : opération inconnue « ${String(tete)} ». Choisissez une opération de la liste proposée.`);
      return 1;
    }
    const arite = { SOMME: [1, 99], FOIS: [2, 2], PCT_PLAFOND: [3, 3], TABLE: [1, 1], PREMIER: [1, 99] }[tete] as [number, number];
    if (args.length < arite[0] || args.length > arite[1]) ajoute("ARITE", `${ou} : l'opération ${tete} n'accepte pas ${args.length} opérande(s). Ajustez le nombre d'opérandes de cette opération.`);
    if (tete === "TABLE") {
      if (typeof args[0] !== "string" || !tables.has(args[0])) ajoute("REFERENCE_INCONNUE", `${ou} : la table « ${String(args[0])} » n'existe pas. Choisissez une table existante (onglet Tables), ou créez-la d'abord.`);
      return 1;
    }
    const profondeur = 1 + Math.max(0, ...args.map((a) => verifierOperande(a, ou, autorises)));
    if (profondeur > PROFONDEUR_MAX) ajoute("PROFONDEUR", `${ou} : trop d'opérations imbriquées (${PROFONDEUR_MAX} au plus) ; nommez une valeur intermédiaire.`);
    return profondeur;
  };
  const autorises = new Set<string>();
  for (const i of b.intermediaires) {
    verifierOperande(i.op, `Valeur intermédiaire « ${i.code} »`, autorises);
    autorises.add(i.code);
  }
  const toutes = new Set(b.intermediaires.map((i) => i.code));

  // Tables : clés lisibles et table complète
  for (const t of b.tables) {
    const ou = `Table « ${t.code} »`;
    const jeux: string[][] = [];
    for (const spec of t.cles) {
      const [code, attribut] = spec.split(".");
      const c = champs.get(code);
      if (!c) {
        ajoute("REFERENCE_INCONNUE", `${ou} : le champ « ${code} » n'existe pas. Choisissez un champ existant, ou retirez-le des champs lus par la table.`);
        continue;
      }
      if (c.type === "OUI_NON" && attribut === undefined) jeux.push(["OUI", "NON"]);
      else if (c.type === "LISTE" && attribut === undefined) jeux.push((c.valeurs ?? []).map(codeValeur));
      else if (c.type === "LISTE" && attribut !== undefined) {
        const tarifs = (c.valeurs ?? []).map((v) => (typeof v === "string" ? undefined : v[attribut]));
        if (tarifs.some((x) => x === undefined)) ajoute("TARIF_ABSENT", `${ou} : toutes les valeurs du champ « ${code} » doivent avoir un « ${attribut} ». Renseignez-le pour chaque valeur de ce champ.`);
        else jeux.push([...new Set(tarifs.map(String))]);
      } else ajoute("CLE_INVALIDE", `${ou} : le champ « ${code} » ne peut pas servir de clé (liste ou oui/non attendu). Choisissez un champ de type liste ou oui/non pour lire la table.`);
    }
    if (jeux.length !== t.cles.length) continue;
    const attendues = jeux.reduce<string[]>((acc, j) => acc.flatMap((a) => j.map((v) => (a === "" ? v : `${a}|${v}`))), [""]);
    const presentes = Object.keys(t.lignes);
    for (const k of attendues.filter((x) => !presentes.includes(x))) ajoute("TABLE_INCOMPLETE", `${ou} : la ligne « ${k} » manque. Ajoutez cette ligne avec son taux (onglet Tables).`);
    for (const k of presentes.filter((x) => !attendues.includes(x))) ajoute("LIGNE_INCONNUE", `${ou} : la ligne « ${k} » ne correspond à aucune valeur des champs lus. Supprimez cette ligne (onglet Tables), ou ajoutez la valeur correspondante au champ.`);
  }

  // Accessoires par tranche d'effectif
  const accessoiresDe: [string, NonNullable<Bareme["produit"]["accessoires"]>][] = [
    ...(b.produit.accessoires ? [["Produit", b.produit.accessoires] as [string, NonNullable<Bareme["produit"]["accessoires"]>]] : []),
    ...b.garanties.flatMap((g) => (g.accessoires ? [[`Garantie « ${g.code} »`, g.accessoires] as [string, NonNullable<Bareme["produit"]["accessoires"]>]] : [])),
  ];
  for (const [ou, acc] of accessoiresDe) {
    if (acc.mode === "PAR_TRANCHE") for (const pb of problemesTranches(acc.tranches)) ajoute(pb.code, `${ou} : accessoires par tranche : ${pb.message}.`);
  }

  // Garanties et composantes
  const sourcesE1 = new Map<string, number>();
  for (const g of b.garanties) {
    if (g.souscription === "CONDITION" && !g.si) ajoute("CONDITION_MANQUANTE", `Garantie « ${g.code} » : « selon une condition » exige une condition. Ajoutez une condition (onglet Garanties), ou changez le mode de souscription.`);
    if (g.si) verifierCondition(g.si, `Garantie « ${g.code} »`);
    for (const c of g.composantes) {
      verifierOperande(c.assiette, `Garantie « ${g.code} », composante « ${c.code} »`, toutes);
      if ("source" in c.taux) sourcesE1.set(`${g.code}.${c.code}`, 0);
    }
  }

  // Sous-jacents
  const resout = (ref: string): string[] => {
    const [g, c] = ref.split(".");
    const garantie = garanties.get(g);
    if (!garantie) return [];
    return garantie.composantes.filter((x) => c === undefined || x.code === c).map((x) => `${g}.${x.code}`);
  };
  for (const s of b.sousJacents) {
    const ou = `Sous-jacent « ${s.code} »`;
    if (s.effet === "E4") {
      if (Array.isArray(s.quand)) {
        verifierOperande(s.quand[1], ou, toutes);
        verifierOperande(s.quand[2], ou, toutes);
      } else verifierCondition(s.quand, ou);
      continue;
    }
    if (!tables.has(s.table)) ajoute("REFERENCE_INCONNUE", `${ou} : la table « ${s.table} » n'existe pas. Choisissez une table existante (onglet Tables), ou créez-la d'abord.`);
    for (const ref of s.cibles) {
      const cibles = resout(ref);
      if (cibles.length === 0) ajoute("CIBLE_INCONNUE", `${ou} : la cible « ${ref} » n'existe pas. Choisissez une garantie ou une composante existante (onglet Garanties).`);
      if (s.effet === "E2" && s.reduction && (ref.includes(".") || cibles.length === 0)) ajoute("CIBLE_REDUCTION", `${ou} : une réduction cible une garantie entière, pas « ${ref} ». Visez la garantie entière.`);
      if (s.effet === "E1") {
        for (const cible of cibles) {
          if (!sourcesE1.has(cible)) ajoute("E1_SUR_TAUX_FIXE", `${ou} : la composante « ${cible} » a un taux fixe, un sous-jacent E1 ne peut pas le remplacer. Retirez cette composante des cibles du sous-jacent, ou donnez-lui un taux « lu dans une table » (onglet Garanties).`);
          else sourcesE1.set(cible, (sourcesE1.get(cible) ?? 0) + 1);
        }
      }
    }
  }
  // D64 : « minimum avant les coefficients » n'a de sens que si la composante a un minimum (fixe, ou sous-jacent E5 MINIMUM qui la vise).
  const avecMinimumE5 = new Set(b.sousJacents.flatMap((s) => (s.effet === "E5" && s.mode === "MINIMUM" ? s.cibles.flatMap(resout) : [])));
  for (const g of b.garanties) {
    for (const c of g.composantes) {
      if (c.minimumAvantCoefficients === true && c.minimum === undefined && !avecMinimumE5.has(`${g.code}.${c.code}`)) {
        ajoute("MINIMUM_ABSENT", `Garantie « ${g.code} », composante « ${c.code} » : « minimum appliqué avant les coefficients » est demandé, mais la composante n'a aucun minimum. Renseignez son minimum (onglet Garanties) ou un sous-jacent E5 « minimum » qui la vise, ou décochez ce réglage.`);
      }
    }
  }
  for (const [cible, n] of sourcesE1) {
    if (n !== 1) ajoute(
      "TAUX_SANS_SOURCE",
      `La composante « ${cible} » attend son taux d'un sous-jacent E1 : ${n === 0 ? "aucun ne la vise" : `${n} la visent`}. ${
        n === 0
          ? "Créez un sous-jacent E1 qui lit une table et vise cette composante (onglet Sous-jacents), ou donnez-lui un taux fixe (onglet Garanties)."
          : "Gardez un seul sous-jacent E1 qui vise cette composante (onglet Sous-jacents) : supprimez les autres ou retirez-lui cette cible."
      }`,
    );
  }

  // Jeux d'essai : un nom par essai, et un résultat attendu qui vérifie quelque chose (un essai sans attendu serait toujours vert).
  doublons("Jeu d'essai", b.jeuxEssai.map((e) => e.nom));
  for (const e of b.jeuxEssai) {
    const aUnMontant = (e.attendu.lignes ?? []).some((l) => l.nette !== undefined || l.acc !== undefined || l.taxe !== undefined || l.ttc !== undefined);
    if (e.attendu.refus === undefined && e.attendu.ttc === undefined && !aUnMontant) {
      ajoute("ESSAI_SANS_ATTENDU", `Jeu d'essai « ${e.nom} » : aucun résultat attendu (ni montant, ni TTC, ni refus) ; il ne vérifierait rien. Saisissez un montant, un TTC ou un refus attendu (onglet Jeux d'essai).`);
    }
  }

  if (options.publication && b.jeuxEssai.length === 0) ajoute("AUCUN_ESSAI", "Aucun jeu d'essai : un barème ne se publie qu'avec au moins un jeu d'essai qui passe. Ajoutez-en un dans l'onglet Jeux d'essai.");
  return p;
}
