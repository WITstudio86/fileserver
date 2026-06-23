// src/components/Header.tsx
import Link from 'next/link';

export default function Header() {
  return (
    <header style={{
      borderBottom: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingTop: 10, paddingBottom: 10,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
          <img
            src="/logo.png"
            alt="FileServer"
            style={{ width: 32, height: 32, borderRadius: 6 }}
          />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px' }}>
            FileServer
          </span>
        </Link>
        <span style={{
          color: 'var(--muted)', fontSize: 12,
          background: '#f3f4f6', padding: '2px 8px', borderRadius: 4,
        }}>
          ZeLab
        </span>
      </div>
    </header>
  );
}
