import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Product Video Studio — AI Product-to-Video Platform",
  description:
    "Submit a product URL, get a researched, compliant, vertical product video.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/store", label: "Store" },
  { href: "/store-admin", label: "Store Admin" },
  { href: "/providers", label: "Providers" },
  { href: "/usage", label: "Usage" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold">
                PV
              </span>
              <span className="font-semibold tracking-tight">
                Product Video Studio
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-zinc-800 py-4">
          <p className="mx-auto max-w-6xl px-4 text-xs text-zinc-500">
            AI Product-to-Video Automation Platform — Phase 2 scaffold. Providers
            are unconfigured until credentials are validated.
          </p>
        </footer>
      </body>
    </html>
  );
}
