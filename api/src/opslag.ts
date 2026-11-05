// Opslag van aangeleverde bestanden: ongewijzigd (originele kwaliteit), op sha256, buiten git.
// Indeling onder config.opslag:
//   projecten/<project>/bron/<sha256>.<ext>        brochures en losse foto's zoals aangeleverd
//   projecten/<project>/import/<volgnummer>/       uitvoer van de brochure-import (aanleveringsmap)
//   kantoren/<kantoor>/<sha256>.<ext>              logo's
//   miniaturen/<sha256>-<breedte>.webp             voorvertoning (afgeleid, mag weg)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { config } from './config.ts';
import { sharp } from './generator.ts';

export const MAX_GROOTTE = { brochure: 150 * 1024 * 1024, foto: 60 * 1024 * 1024, logo: 10 * 1024 * 1024 };

/** Bestandstype uit de inhoud (niet uit naam of opgegeven type). */
export function herkenType(b: Buffer): { mime: string; ext: string } | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1'))) return { mime: 'image/tiff', ext: 'tif' };
  if (b.subarray(4, 12).toString('latin1').match(/^ftyp(heic|heix|mif1|hevc)/)) return { mime: 'image/heic', ext: 'heic' };
  const kop = b.subarray(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(kop)) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Absoluut pad binnen de opslag; weigert alles wat erbuiten zou vallen. */
export function opslagPad(rel: string) {
  const p = normalize(join(config.opslag, rel));
  if (!p.startsWith(normalize(config.opslag) + sep)) throw new Error('pad buiten de opslag');
  return p;
}

export function bewaar(rel: string, b: Buffer) {
  const p = opslagPad(rel);
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeFileSync(p, b, { mode: 0o600 });
  return rel;
}

/** Afmetingen (na EXIF-rotatie) en dHash, op dezelfde manier als de generator. */
export async function beeldInfo(b: Buffer) {
  const md = await sharp(b).metadata();
  const draai = (md.orientation ?? 1) >= 5;
  const { data } = await sharp(b).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return { breedte: (draai ? md.height : md.width) as number, hoogte: (draai ? md.width : md.height) as number,
    dhash: BigInt('0b' + bits).toString(16).padStart(16, '0') };
}

/** Voorvertoning (webp), eenmalig gemaakt en daarna uit de opslag. */
export async function miniatuur(rel: string, hash: string, breedte = 480) {
  const doel = opslagPad(`miniaturen/${hash}-${breedte}.webp`);
  if (!existsSync(doel)) {
    mkdirSync(dirname(doel), { recursive: true });
    await sharp(readFileSync(opslagPad(rel))).rotate().resize({ width: breedte, height: breedte, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(doel);
  }
  return readFileSync(doel);
}
