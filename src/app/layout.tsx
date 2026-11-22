import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BushBIM",
  description: "Construction document control, field management and project collaboration for African resort developments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
