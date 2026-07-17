import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Turing-Complete Canvas · fal × Sequoia Dev Track",
  description:
    "A generative video stream that behaves like a software interface. Click any object to spawn contextual control panels and branch the narrative in real time.",
  keywords: [
    "fal.ai",
    "LTX-2.3",
    "Florence-2",
    "A2UI",
    "generative video",
    "interactive video",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        style={{ background: "#000", color: "#e2e8f0" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
