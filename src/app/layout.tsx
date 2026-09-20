import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'
import { Sidebar } from '@/components/sidebar'

export const metadata: Metadata = {
  title: 'Discordbase — Local Discord Archive',
  description: 'Local-only Discord knowledge base with automated archiving',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0f0f23] text-[#e8e8e8] font-mono">
        <Providers>
          <div className="min-h-screen flex">
            <Sidebar />
            <main className="flex-1 p-6 overflow-auto">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
