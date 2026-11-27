import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/offline/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "BushBIM",
  description: "Construction document control, field management and project collaboration for African resort developments.",
  applicationName: "BushBIM",
  appleWebApp: { capable: true, title: "BushBIM", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#1c2b24" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
