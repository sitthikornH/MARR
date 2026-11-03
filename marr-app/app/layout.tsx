import type { Metadata } from "next";
import NavBar from "./NavBar";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Project MARR | HR Welfare",
  description: "HR Welfare management system for employee attendance and welfare calculations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}>
        <NavBar />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 print:max-w-none print:p-0">{children}</main>
      </body>
    </html>
  );
}
