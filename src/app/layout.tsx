import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discordbase — Local Discord Archive",
  description: "Local-only Discord knowledge base with automated archiving",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-[#0f0f23] text-[#e8e8e8] font-mono">
        <div className="min-h-screen flex">
          {/* TODO: Sidebar Navigation */}
          <main className="flex-1 p-4">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
