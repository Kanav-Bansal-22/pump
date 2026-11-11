import type { Metadata, Viewport } from "next";
import { DemoBanner } from "@/components/ui";
import { activeDatabase } from "@/server/db";
import "./globals.css";

export const metadata: Metadata = {
  title: "Petrol Pump",
  description: "Petrol pump accounts and nozzle readings",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <DemoBanner database={activeDatabase()} />
        {children}
      </body>
    </html>
  );
}
