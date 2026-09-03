import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insta-pro | Community-First Pseudonymous Social Platform",
  description:
    "An open-source, pseudonymous, community-first social platform with explainable feeds and transparent moderation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0c] text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
