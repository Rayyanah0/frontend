import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PwaShell } from "../components/PwaShell";
import { StoreHydrator } from "../components/StoreHydrator";
import { BackendDataProvider } from "../lib/context/BackendDataContext";
import { SessionBanner } from "../components/SessionBanner";
import { Toaster } from "../components/toast/Toaster";
import { ContractErrorOverlay } from "../components/ContractErrorOverlay";
import { QueryProvider } from "../components/QueryProvider";
import { SpotFeedProvider } from "../lib/context/SpotFeedContext";
import { NetworkMismatchBanner } from "../components/NetworkMismatchBanner";
import { SorobanEventBridge } from "../components/SorobanEventBridge";
import { CommandLayer } from "../components/command/CommandLayer";

const fraunces = Fraunces({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-fraunces", display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-plex-sans", display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-jetbrains-mono", display: "swap",
});

export const metadata: Metadata = {
  title: "Zenith | On-chain Options on Stellar",
  description:
    "Buy and write European put and call options on XLM, BTC, ETH, and SOL. The first decentralized options protocol on Stellar Soroban.",
  manifest: "/manifest.webmanifest",
  keywords: ["options", "calls", "puts", "derivatives", "stellar", "soroban", "defi", "black-scholes"],
};

// viewportFit: "cover" is what makes env(safe-area-inset-*) non-zero on iOS —
// required for the bottom sheet / bottom status bar to clear the home
// indicator. Pinch-zoom is deliberately left enabled (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14130F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        <StoreHydrator />
        <Toaster />
        <SessionBanner />
        <ContractErrorOverlay />
        <QueryProvider>
          <SpotFeedProvider>
            <BackendDataProvider>
              <NetworkMismatchBanner />
              <SorobanEventBridge>
                <CommandLayer>{children}</CommandLayer>
              </SorobanEventBridge>
            </BackendDataProvider>
            <PwaShell />
          </SpotFeedProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
