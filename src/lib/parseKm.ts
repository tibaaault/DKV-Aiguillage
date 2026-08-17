import { extractFleetCode, headerKey, normalizeImmat, parseDate, parseNumber } from './normalize';
import type { KmRecord } from './model';

export interface KmParseResult {
  records: KmRecord[];
  fileName: string;
  warnings: string[];
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** Alias acceptes pour chaque colonne du releve kilometrique. */
const COLUMNS = {
  immat: ['numerodimmatriculation', 'ndimmatriculation', 'immatriculation', 'immat', 'plaque'],
  code: ['code', 'codeflotte', 'codevehicule', 'centredecouts'],
  start: ['debut', 'datedebut', 'du'],
  end: ['fin', 'datefin', 'au'],
  kmStart: ['kmdepart', 'kmdebut', 'kilometragedepart', 'compteurdepart'],
  kmEnd: ['kmarrivee', 'kmfin', 'kilometragearrivee', 'compteurarrivee'],
  km: ['km', 'kmparcourus', 'kmeffectues', 'distance'],
} as const;

type ColumnName = keyof typeof COLUMNS;

/** Devine le separateur d'un fichier delimite en comptant les occurrences sur l'en-tete. */
function detectDelimiter(headerLine: string): string {
  const candidates = [';', '\t', ',', '|'];
  let best = ';';
  let bestCount = 0;
  for (const c of candidates) {
    const count = headerLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

/** Decoupe une ligne CSV en gerant les champs entre guillemets. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Decode un fichier texte en essayant l'UTF-8 puis, si le resultat contient des
 * caracteres de remplacement, le Windows-1252 des exports Windows.
 */
export function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '');
  const win = new TextDecoder('windows-1252').decode(buffer);
  return win.replace(/^\uFEFF/, '');
}

/** Associe chaque colonne connue a son index dans l'en-tete. */
function mapColumns(header: string[]): Partial<Record<ColumnName, number>> {
  const keys = header.map(headerKey);
  const map: Partial<Record<ColumnName, number>> = {};
  for (const [name, aliases] of Object.entries(COLUMNS) as Array<[ColumnName, readonly string[]]>) {
    // Correspondance exacte d'abord, puis « commence par » pour absorber les suffixes.
    let idx = keys.findIndex((k) => k && aliases.includes(k));
    if (idx < 0) idx = keys.findIndex((k) => k && aliases.some((a) => k.startsWith(a) && a.length > 3));
    if (idx >= 0) map[name] = idx;
  }
  return map;
}

/** Parse le releve kilometrique TICPE (fichier texte delimite). */
export function parseKmFile(text: string, fileName: string): KmParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    return { records: [], fileName, warnings: ['Le fichier est vide.'], periodStart: null, periodEnd: null };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter);
  const cols = mapColumns(header);

  if (cols.immat == null) {
    warnings.push(
      "Colonne d'immatriculation introuvable. Colonnes lues : " + header.filter(Boolean).join(', ') + '.',
    );
    return { records: [], fileName, warnings, periodStart: null, periodEnd: null };
  }
  if (cols.kmStart == null || cols.kmEnd == null) {
    warnings.push('Colonnes « Km départ » / « Km arrivée » introuvables : les km parcourus seront lus tels quels.');
  }

  const records: KmRecord[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    const rawImmat = cells[cols.immat] ?? '';
    // La derniere ligne des exports est une ligne « Total ».
    if (/^total/i.test(rawImmat.trim())) continue;

    const immat = normalizeImmat(rawImmat);
    if (!immat) {
      if (rawImmat.trim()) warnings.push(`Ligne ${i + 1} : immatriculation illisible « ${rawImmat} », ligne ignorée.`);
      continue;
    }

    const kmStart = cols.kmStart != null ? parseNumber(cells[cols.kmStart]) : null;
    const kmEnd = cols.kmEnd != null ? parseNumber(cells[cols.kmEnd]) : null;
    let km = cols.km != null ? parseNumber(cells[cols.km]) : null;
    if (km == null && kmStart != null && kmEnd != null) km = kmEnd - kmStart;

    const record: KmRecord = {
      immat,
      rawImmat: rawImmat.trim(),
      fleetCode: cols.code != null ? extractFleetCode(cells[cols.code]) : '',
      start: cols.start != null ? parseDate(cells[cols.start]) : null,
      end: cols.end != null ? parseDate(cells[cols.end]) : null,
      kmStart,
      kmEnd,
      km,
      sourceLine: i + 1,
    };

    const previous = seen.get(immat);
    if (previous != null) {
      warnings.push(`Immatriculation ${rawImmat} présente plusieurs fois (lignes ${previous} et ${i + 1}).`);
    }
    seen.set(immat, i + 1);
    records.push(record);
  }

  // Coherence interne : km annonces contre km recalcules.
  for (const r of records) {
    if (r.km != null && r.kmStart != null && r.kmEnd != null) {
      const computed = r.kmEnd - r.kmStart;
      if (Math.abs(computed - r.km) > 1) {
        warnings.push(
          `${r.rawImmat} : la colonne Km annonce ${r.km} alors que l'écart des compteurs donne ${computed}.`,
        );
      }
    }
  }

  const dates = records.flatMap((r) => [r.start, r.end]).filter((d): d is Date => d != null);
  const periodStart = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const periodEnd = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  return { records, fileName, warnings, periodStart, periodEnd };
}
