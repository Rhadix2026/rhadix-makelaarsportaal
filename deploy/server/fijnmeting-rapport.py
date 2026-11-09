#!/usr/bin/env python3
"""Fijnmeting per fase: koppelt fijn.csv (meting-fijn.sh, elke 2 s) aan de verwerkingen in de database.

    fijnmeting-rapport.py [--project makelaarsportaal-test] [--csv /var/log/makelaarsportaal/fijn.csv] [--sinds 2026-11-09]

Fasen volgen uit de vastgelegde staptijden (verwerking.stappen), in volgorde vanaf gestart_op:
  brochure-import:  import, controle (samen 'brochure-import'), classificatie ('beeldclassificatie')
  conceptgeneratie: aanleveren, classificatie, woningmap, bouw, kwaliteit (samen 'conceptgeneratie', ook per stap)
Leest alleen: de CSV en (via psql in de db-container) tijden en soorten van verwerkingen, geen inhoud.
"""
import argparse, csv, json, subprocess, sys
from datetime import datetime, timedelta

ap = argparse.ArgumentParser()
ap.add_argument('--project', default='makelaarsportaal-test')
ap.add_argument('--csv', default='/var/log/makelaarsportaal/fijn.csv')
ap.add_argument('--sinds', default='1970-01-01')
ap.add_argument('--json', action='store_true', help='uitvoer als JSON')
a = ap.parse_args()

sql = ("SELECT coalesce(json_agg(json_build_object('nr', volgnummer, 'soort', soort, 'status', status, 'gestart', gestart_op, "
       "'klaar', klaar_op, 'duur_ms', duur_ms, 'stappen', stappen) ORDER BY gestart_op), '[]') FROM verwerking "
       f"WHERE gestart_op >= '{a.sinds}'::date AND soort IN ('brochure-import', 'conceptgeneratie')")
uit = subprocess.run(['docker', 'exec', f'{a.project}-db-1', 'psql', '-U', 'studio', '-d', 'studio', '-At', '-c', sql],
                     capture_output=True, text=True, check=True).stdout
verwerkingen = json.loads(uit or '[]')

rijen = []
try:
    with open(a.csv) as f:
        for r in csv.DictReader(f, delimiter=';'):
            r['t'] = datetime.fromisoformat(r['tijd'])
            rijen.append(r)
except FileNotFoundError:
    print(f'(nog geen fijnmeting: {a.csv} bestaat niet)', file=sys.stderr)

def getal(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def samenvatting(van, tot):
    deel = [r for r in rijen if van <= r['t'] <= tot]
    per = {}
    for r in deel: per.setdefault(r['bron'], []).append(r)
    res = {'metingen': len(per.get('systeem', []))}
    for bron, rs in per.items():
        kol = {k: [v for v in (getal(r[k]) for r in rs) if v is not None] for k in ('cpu_pct', 'geheugen_mb', 'swap_mb', 'anon_mb', 'file_mb', 'mem_beschikbaar_mb')}
        s = {}
        for k, v in kol.items():
            if not v: continue
            s[k] = {'max': max(v), 'gem': round(sum(v) / len(v), 1)}
            if k == 'mem_beschikbaar_mb': s[k]['min'] = min(v)
        res[bron.replace(f'{a.project}-', '').replace('-1', '')] = s
    return res

FASEN = {'brochure-import': [(('import', 'controle'), 'brochure-import'), (('classificatie',), 'beeldclassificatie')],
         'conceptgeneratie': [(('aanleveren', 'classificatie', 'woningmap', 'bouw', 'kwaliteit'), 'conceptgeneratie')]}
rapport = []
for v in verwerkingen:
    if not v['gestart'] or not v['klaar']: continue
    start, eind = datetime.fromisoformat(v['gestart']), datetime.fromisoformat(v['klaar'])
    st = v['stappen'] or {}
    item = {'verwerking': v['nr'], 'soort': v['soort'], 'status': v['status'], 'gestart': v['gestart'], 'duur_s': round((v['duur_ms'] or 0) / 1000, 1), 'fasen': []}
    t = start
    for stappen, naam in FASEN.get(v['soort'], []):
        ms = sum(st.get(s, 0) or 0 for s in stappen)
        van, tot = t, (t + timedelta(milliseconds=ms)) if naam != 'conceptgeneratie' and naam != 'beeldclassificatie' else eind
        fase = {'fase': naam, 'duur_s': round(ms / 1000, 1), 'stappen_ms': {s: st.get(s) for s in stappen if s in st}, 'meting': samenvatting(van, tot)}
        item['fasen'].append(fase)
        t = t + timedelta(milliseconds=ms)
    rapport.append(item)

if a.json:
    json.dump(rapport, sys.stdout, indent=1, default=str)
else:
    for it in rapport:
        print(f"\n== verwerking {it['verwerking']} {it['soort']} ({it['status']}), gestart {it['gestart']}, totaal {it['duur_s']} s")
        for f in it['fasen']:
            m = f['meting']
            print(f"  -- {f['fase']}: {f['duur_s']} s {f['stappen_ms']}  ({m['metingen']} metingen à 2 s)")
            for bron in ('systeem', 'verwerker', 'api', 'db', 'web'):
                s = m.get(bron)
                if not s: continue
                d = lambda k, w='max': s.get(k, {}).get(w, '—')
                extra = f" werkgeheugen max {d('anon_mb')} MB, cache max {d('file_mb')} MB" if bron == 'verwerker' else ''
                besch = f", beschikbaar min {d('mem_beschikbaar_mb', 'min')} MB" if bron == 'systeem' else ''
                print(f"     {bron:10} CPU gem {d('cpu_pct','gem')} % max {d('cpu_pct')} % · geheugen max {d('geheugen_mb')} MB · swap max {d('swap_mb')} MB{extra}{besch}")
