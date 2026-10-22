import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "NUAS KNUST Dinner & Awards Night 2026",
  description: "Official portal for the NUAS KNUST Dinner and Awards Night. Browse nominees, vote across categories, and book gala tickets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
