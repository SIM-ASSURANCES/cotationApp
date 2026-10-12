/** Assemble des noms de classes en ignorant les valeurs vides : cx("a", cond && "b", undefined) → "a b". */
export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(" ");
