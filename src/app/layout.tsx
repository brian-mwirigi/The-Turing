import type { Metadata } from "next";
import { Instrument_Serif, Syne } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const filmSerif = Instrument_Serif({
  variable: "--font-film",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const studioSans = Syne({
  variable: "--font-studio",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "The Turing-Complete Canvas · a film you finish by clicking",
  description:
    "A filmmaker died mid-edit of the only film she ever cared about. Her cutting room was left as it was. You don't watch it — you finish it. An interactive generative video wrapped in an agent-to-user interface: click anything in the film and rewrite the cut.",
  keywords: [
    "fal.ai",
    "LTX-2.3",
    "Florence-2",
    "Veo 3.1",
    "A2UI",
    "generative video",
    "interactive film",
    "spatial computing",
    "Sequoia",
    "hackathon",
  ],
  authors: [{ name: "Turing-Complete Canvas" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${filmSerif.variable} ${studioSans.variable} antialiased`}
        style={{ background: "#000", color: "#e2e8f0" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
