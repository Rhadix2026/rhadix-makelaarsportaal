// Basiscomponenten in de Rhadix-look-and-feel (opnieuw vastgelegd, zie tokens.css).
import type { ReactNode } from 'react';

export function Navigatie({ rechts }: { rechts?: ReactNode }) {
  return (
    <header className="nav">
      <div className="nav-merk">
        <span className="nav-naam">Makelaarsplatform</span>
        <span className="nav-sub">Productiestudio</span>
      </div>
      <div className="nav-rechts">{rechts}</div>
    </header>
  );
}

export function Pagina({ children }: { children: ReactNode }) {
  return <main className="pagina">{children}</main>;
}

export function PaginaTitel({ titel, sub, badge }: { titel: string; sub?: string; badge?: string }) {
  return (
    <div className="titel">
      {badge && <div className="titel-badge">{badge}</div>}
      <h1>{titel}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

export function Kaart({ titel, children }: { titel?: string; children: ReactNode }) {
  return (
    <section className="kaart">
      {titel && <h2>{titel}</h2>}
      {children}
    </section>
  );
}

export function StatKaart({ label, waarde, sub, toon }: { label: string; waarde: ReactNode; sub?: ReactNode; toon?: Toon }) {
  return (
    <section className="kaart" aria-label={label}>
      <div className="stat-waarde">{waarde}</div>
      <div className="stat-label">{label}</div>
      {toon && <div className="stat-sub"><Badge toon={toon}>{TOON_TEKST[toon]}</Badge></div>}
      {sub && <div className="stat-sub">{sub}</div>}
    </section>
  );
}

export type Toon = 'goed' | 'let-op' | 'fout' | 'info';
const TOON_TEKST: Record<Toon, string> = { goed: 'In orde', 'let-op': 'Let op', fout: 'Niet beschikbaar', info: 'Info' };

export function Badge({ toon = 'info', children }: { toon?: Toon; children: ReactNode }) {
  return <span className={`badge badge-${toon}`}>{children}</span>;
}

export function KnopPrimair({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" className="knop knop-primair" onClick={onClick}>{children}</button>;
}

export function KnopLijn({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className="knop knop-lijn" onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Gegevens({ rijen }: { rijen: [string, ReactNode][] }) {
  return (
    <table className="tabel">
      <tbody>
        {rijen.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
      </tbody>
    </table>
  );
}
