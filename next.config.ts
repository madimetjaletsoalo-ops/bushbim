import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js starts its OCR engine in a worker thread from its own files,
  // so it must stay a plain node_modules package rather than be bundled
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // the English OCR data is read from disk at run time, by the routes that index files
  outputFileTracingIncludes: Object.fromEntries(
    ["/projects/[projectId]/docs/**", "/projects/[projectId]/reviews/**", "/projects/[projectId]/search", "/api/jobs/index-text"].map((route) => [
      route,
      ["./node_modules/@tesseract.js-data/eng/4.0.0/**"],
    ]),
  ),
};

export default nextConfig;
