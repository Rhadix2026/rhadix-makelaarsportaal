// Gebruikers en rollen: alleen-lezen overzicht (zie api/src/toegang.ts). Wijzigingen gebeuren uitsluitend
// centraal in het Rhadix-platform; dit scherm heeft geen enkele wijzigende handeling.
import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Badge, Kaart, PaginaTitel } from './onderdelen/basis.tsx';

type Lid = { gebruiker_id: string; naam: string; email: string; rol?: string; bron: string; actief: boolean; sinds: string };
type Overzicht = {
  rol: 'platformbeheer' | 'kantoorbeheerder';
  centraal_beheer: string | null;
  kantoren: { id: string; merknaam: string; slug: string; status: string; rhadix_organisatie?: { tenant_id: string; naam: string | null } | null; leden: Lid[] }[];
  platformbeheerders?: Lid[];
};

const ROL: Record<string, string> = { kantoorbeheerder: 'Kantoorbeheerder', makelaar: 'Makelaar' };
const datum = (d: string) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });

function Leden({ leden, metRol = true }: { leden: Lid[]; metRol?: boolean }) {
  if (!leden.length) return <p className="stat-sub" style={{ margin: 0 }}>Nog niemand heeft zich aangemeld. Gebruikers verschijnen hier na hun eerste aanmelding.</p>;
  return (
    <div className="tabel-schuif">
      <table className="tabel">
        <thead><tr><th>Naam</th>{metRol && <th>Rol</th>}<th>Aanmelding</th><th>In het portaal sinds</th></tr></thead>
        <tbody>{leden.map((l) => (
          <tr key={l.gebruiker_id}>
            <td>{l.naam}<div className="stat-sub">{l.email}</div></td>
            {metRol && <td>{ROL[l.rol ?? ''] ?? l.rol}</td>}
            <td>{l.bron === 'rhadix' ? 'Rhadix-platform' : 'Noodtoegang (lokaal)'}{!l.actief && <> <Badge toon="fout">gedeactiveerd</Badge></>}</td>
            <td>{datum(l.sinds)}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function GebruikersScherm() {
  const [d, setD] = useState<Overzicht | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<Overzicht>('/api/toegang').then(setD, (e) => setFout(e.message)); }, []);
  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!d) return null;
  const platform = d.rol === 'platformbeheer';
  return (
    <div className="gebruikers">
      <PaginaTitel badge="Beheer" titel="Gebruikers en rollen"
        sub={platform ? 'Wie toegang heeft tot het makelaarsportaal, per makelaarskantoor.' : 'Wie toegang heeft tot het makelaarsportaal binnen uw kantoor.'} />

      {platform ? (
        <Kaart titel="Centraal beheer">
          <p className="stat-sub" style={{ marginTop: 0 }}>Gebruikers, rollen, licenties en toegang tot applicaties worden uitsluitend beheerd in het Rhadix-platform. Dit overzicht is alleen ter inzage; wijzigingen werken door bij de volgende aanmelding van de gebruiker.</p>
          {d.centraal_beheer
            ? <a className="knop knop-primair" href={d.centraal_beheer} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Naar het centrale Rhadix-beheer ↗</a>
            : <p className="melding melding-let-op" role="status">De centrale Rhadix-login is in deze omgeving niet ingesteld.</p>}
          <details className="toegang-uitleg">
            <summary>Zo krijgt een nieuwe gebruiker toegang</summary>
            <ol>
              <li><strong>Organisatie:</strong> het makelaarskantoor bestaat in het Rhadix-platform als organisatie van het type Makelaarskantoor, en is hier bij <a href="#/kantoren">Kantoren</a> aan die organisatie gekoppeld.</li>
              <li><strong>Applicatie voor de organisatie:</strong> de organisatie heeft "Rhadix Makelaarsportaal" toegewezen gekregen (binnen de licentie en het maximum aantal gebruikers).</li>
              <li><strong>Gebruiker en rol:</strong> de gebruiker wordt in die organisatie aangemaakt als <em>organisatiebeheerder</em> (wordt hier kantoorbeheerder) of <em>gebruiker</em> (wordt hier makelaar).</li>
              <li><strong>Applicatie voor de gebruiker:</strong> de gebruiker krijgt ook persoonlijk "Rhadix Makelaarsportaal" toegewezen. Beide toewijzingen (organisatie én gebruiker) zijn nodig.</li>
              <li><strong>Eerste aanmelding:</strong> bij de eerste aanmelding maakt het portaal de gebruiker automatisch aan, met kantoor en rol uit het Rhadix-platform. Er is hier niets handmatig nodig.</li>
            </ol>
          </details>
        </Kaart>
      ) : (
        <Kaart titel="Een gebruiker toevoegen of wijzigen?">
          <p className="stat-sub" style={{ margin: 0 }}>Gebruikers en rollen worden centraal door Rhadix beheerd. Neem voor het toevoegen, wijzigen of verwijderen van een gebruiker contact op met Rhadix; Rhadix verwerkt de wijziging en die werkt door bij de volgende aanmelding.</p>
        </Kaart>
      )}

      {d.kantoren.map((k) => (
        <Kaart key={k.id} titel={k.merknaam}>
          {platform && (
            <p className="stat-sub" style={{ marginTop: 0 }}>
              Rhadix-organisatie: {k.rhadix_organisatie ? <>{k.rhadix_organisatie.naam ?? 'naam nog onbekend'} <span className="mono">({k.rhadix_organisatie.tenant_id.slice(0, 8)}…)</span></> : <><Badge toon="let-op">niet gekoppeld</Badge> zonder koppeling kan niemand van dit kantoor zich via Rhadix aanmelden. <a href={`#/kantoren/${k.id}`}>Koppelen</a></>}
              {k.status !== 'actief' && <> · <Badge toon="let-op">{k.status}</Badge></>}
            </p>
          )}
          <Leden leden={k.leden} />
        </Kaart>
      ))}

      {platform && d.platformbeheerders && (
        <Kaart titel="Rhadix-platformbeheer">
          <p className="stat-sub" style={{ marginTop: 0 }}>Toegang tot alle kantoren. Deze rol wordt in het Rhadix-platform toegekend.</p>
          <Leden leden={d.platformbeheerders} metRol={false} />
        </Kaart>
      )}
    </div>
  );
}
