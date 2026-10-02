import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./terra.css";
import "./refinements.css";
import "./maps.css";
import "./earthscope.css";
import "./report.css";

export const metadata: Metadata = {
  title: "EarthScope — Climate Time Machine",
  description: "A new perspective on our changing planet. Explore climate history, real satellite imagery, and the possibilities ahead.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/icon-192.png",
  },
  appleWebApp: { capable: true, title: "EarthScope", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#040a18" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://gibs.earthdata.nasa.gov" />
        <link rel="dns-prefetch" href="https://power.larc.nasa.gov" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function isExtensionNoise(err) {
                  if (!err) return false;
                  var msg = (typeof err === "string" ? err : err.message || err.description || String(err) || "").toLowerCase();
                  var stack = (err && err.stack ? String(err.stack) : "").toLowerCase();
                  return (
                    msg.indexOf("metamask") !== -1 ||
                    msg.indexOf("failed to connect") !== -1 ||
                    msg.indexOf("coinbase") !== -1 ||
                    msg.indexOf("phantom") !== -1 ||
                    msg.indexOf("ethereum") !== -1 ||
                    stack.indexOf("chrome-extension://") !== -1 ||
                    stack.indexOf("moz-extension://") !== -1 ||
                    stack.indexOf("inpage.js") !== -1 ||
                    stack.indexOf("nkbihfbeogaeaoehlefnkodbefgpgknn") !== -1
                  );
                }
                window.addEventListener("unhandledrejection", function(event) {
                  if (isExtensionNoise(event.reason)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                  }
                }, true);
                window.addEventListener("error", function(event) {
                  if (
                    isExtensionNoise(event.error || event.message) ||
                    (event.filename && (
                      event.filename.indexOf("chrome-extension://") !== -1 ||
                      event.filename.indexOf("moz-extension://") !== -1
                    ))
                  ) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                  }
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
