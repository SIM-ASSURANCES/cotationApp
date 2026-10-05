import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIM Documents",
  description: "Génération des documents d'assurance de SIM Assurances CI",
};

// Polices du système (pile par défaut de Tailwind) : rien n'est téléchargé
// depuis Internet, ni à la construction ni à l'exécution.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
