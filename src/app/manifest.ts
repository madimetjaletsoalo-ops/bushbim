import type { MetadataRoute } from "next";

/** Web app manifest: lets site teams install BushBIM on their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BushBIM",
    short_name: "BushBIM",
    description: "Construction document control, field management and project collaboration for African resort developments.",
    start_url: "/projects",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1c2b24",
    theme_color: "#1c2b24",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
