import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "NUAS KNUST Dinner & Awards Night 2026",
  description: "Official portal for the National Union of Anglican Students (NUAS), KNUST Chapter Annual Dinner and Awards Night. Celebrate student ministry, vote across categories, and book gala tickets.",
  icons: {
    icon: "/images/nuas-logo.png",
    apple: "/images/nuas-logo.png",
  },
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
