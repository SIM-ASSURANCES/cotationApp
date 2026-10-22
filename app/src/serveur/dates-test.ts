// Aide des tests de bout en bout : dates calculées à partir d'aujourd'hui (Africa/Abidjan), jamais de date fixe.
// Une cotation ne peut pas prendre effet avant aujourd'hui : on commence demain.
import { ajouterJours, aujourdhui, type DateIso } from "@/domaine/calcul/dates";

/** Début d'une période de test : demain. */
export const debutTest = (): DateIso => ajouterJours(aujourdhui(), 1);

/** Fin d'une période de `jours` jours qui commence à `debut` (le jour de début compte) : 365 jours par défaut, une année pleine. */
export const finTest = (debut: DateIso, jours = 365): DateIso => ajouterJours(debut, jours - 1);
