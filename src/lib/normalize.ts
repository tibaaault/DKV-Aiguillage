/**
 * Normalisation des valeurs bruitees venant des exports DKV et du releve
 * kilometrique. Tout le rapprochement repose sur ces fonctions : une immat
 * ecrite « FV-193-CR », « FV193CR » ou « fv 193 cr » doit produire la meme cle.
 */

/** Retire les accents et passe en minuscules. Utilise pour comparer des en-tetes. */
export function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Cle de comparaison d'en-tete de colonne : « N° d'immatriculation » -> « ndimmatriculation ». */
export function headerKey(value: unknown): string {
  return deaccent(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Cle canonique d'une immatriculation : uniquement lettres et chiffres, en
 * majuscules. Renvoie une chaine vide si la valeur ne ressemble pas a une immat.
 */
export function normalizeImmat(value: unknown): string {
  const raw = deaccent(String(value ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return '';
  // Les exports contiennent des libelles parasites en lieu et place de l'immat.
  if (/^(RELAIS|DIVERS|INCONNU|SANS|NA|ND)\d*$/.test(raw)) return '';
  if (raw.length < 5 || raw.length > 12) return '';
  return raw;
}

/** Format francais SIV : FT209WB -> FT-209-WB. Les autres formats sont laisses tels quels. */
export function formatImmat(immat: string): string {
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(immat);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const old = /^(\d{1,4})([A-Z]{2,3})(\d{2,3})$/.exec(immat);
  if (old) return `${old[1]} ${old[2]} ${old[3]}`;
  return immat;
}

/**
 * Extrait le code flotte d'une colonne « Code » du releve kilometrique.
 * Accepte « 74303 », « ET-502-NJ - 79418 » ou « PF-96501 ».
 */
export function extractFleetCode(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const matches = raw.match(/\d{4,7}/g);
  if (!matches) return '';
  // Une immat au format SIV ne contient que 3 chiffres consecutifs : pas de collision.
  return matches[matches.length - 1];
}

/** Parse un nombre ecrit a la francaise (« 1 234,56 ») ou a l'anglaise (« 1234.56 »). */
export function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[\s\u00a0\u202f]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Le dernier separateur rencontre est le separateur decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** Convertit un numero de serie Excel en Date (UTC, sans decalage de fuseau). */
export function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial * 86400000));
}

/**
 * Parse une date provenant d'un fichier source. Gere les numeros de serie Excel,
 * les objets Date, et les chaines « jj/mm/aaaa [hh:mm[:ss]] ».
 */
export function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Les dates Excel plausibles vont de 1990 (32874) a 2100 (73415).
    if (value > 20000 && value < 80000) return excelSerialToDate(value);
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (fr) {
    const [, d, mo, y, h = '0', mi = '0', sec = '0'] = fr;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = iso;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)));
  }
  const numeric = parseNumber(s);
  if (numeric != null && numeric > 20000 && numeric < 80000) return excelSerialToDate(numeric);
  return null;
}

/** Affichage court « jj/mm/aaaa ». */
export function formatDate(date: Date | null): string {
  if (!date) return '';
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

/** Affichage « jj/mm/aaaa hh:mm ». */
export function formatDateTime(date: Date | null): string {
  if (!date) return '';
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${h}:${mi}`;
}

/** Cle de trimestre « 2026-T1 » a partir d'une date. */
export function quarterKey(date: Date): string {
  return `${date.getUTCFullYear()}-T${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Hachage stable et court, utilise pour identifier une transaction entre deux imports. */
export function stableHash(parts: Array<string | number | null | undefined>): string {
  const input = parts.map((p) => (p == null ? '' : String(p))).join('');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).padStart(12, '0');
}
