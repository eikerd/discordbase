'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/', label: 'DASHBOARD', icon: '▦' },
  { href: '/servers', label: 'SERVERS', icon: '◉' },
  { href: '/settings', label: 'SETTINGS', icon: '⚙' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="w-48 min-h-screen flex flex-col"
      style={{ background: '#0a0a1a', borderRight: '2px solid #2a2a4a' }}
    >
      {/* Logo */}
      <div className="p-4 border-b-2 border-[#2a2a4a]">
        <div className="text-[#00ff41] font-bold text-xs tracking-widest">DISCORD</div>
        <div className="text-[#00ff41] font-bold text-xs tracking-widest">BASE</div>
        <div className="text-[#a8a8c8] text-[9px] mt-1">v0.1.0</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold transition-colors"
              style={{
                color: active ? '#0f0f23' : '#a8a8c8',
                background: active ? '#00ff41' : 'transparent',
                border: '2px solid',
                borderColor: active ? '#00ff41' : 'transparent',
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t-2 border-[#2a2a4a] text-[9px] text-[#4a4a6a]">
        LOCAL ONLY • NO CLOUD
      </div>
    </aside>
  )
}
