import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider, ThemeScript } from "@/components/shell/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Affiliate Automation ERP",
    template: "%s · Affiliate ERP"
  },
  description:
    "Hệ thống tự động hóa Affiliate Marketing & Social Seeding: Quét radar, viết bình luận AI, nuôi nick và đo lường doanh thu Sub_ID.",
  applicationName: "Affiliate ERP",
  appleWebApp: { capable: true, title: "Affiliate ERP", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Required for env(safe-area-inset-*) to report real values on iOS.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
