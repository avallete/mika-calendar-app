import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { AppHeader } from "@/components/planner/app-header";
import { PlannerProvider } from "@/components/planner/planner-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AppCalendar Mika",
  description: "Calendar and project planning cockpit for Team A and Team B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),rgba(243,238,231,0.88)_52%,rgba(233,227,218,0.82))] text-foreground">
        <PlannerProvider>
          <TooltipProvider>
            <div className="flex min-h-full flex-col">
              <AppHeader />
              <main className="flex flex-1 flex-col">{children}</main>
            </div>
          </TooltipProvider>
        </PlannerProvider>
      </body>
    </html>
  );
}
