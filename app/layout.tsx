import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const displayFont = Space_Grotesk({
  variable: "--font-app-display",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Orbit Planner",
  description:
    "Plan an itinerary, compare travel legs, and watch your movement animate on a 3D globe.",
};

const bodyFont = Space_Grotesk({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
