import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/nav-progress";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Zinny", template: "%s · Zinny" },
  description: "Courses, batches, tests and students — one private space per institute.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f5f7" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans text-[15px] leading-relaxed">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
