import type { Metadata } from "next";
import { Bodoni_Moda, Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Long Box — Find your way into comics",
    template: "%s | Long Box",
  },
  description:
    "Explainable starting points and reading paths for comic characters and story arcs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${bodoni.variable}`}>
      <body>{children}</body>
    </html>
  );
}
