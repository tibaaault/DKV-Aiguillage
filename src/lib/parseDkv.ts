import * as XLSX from 'xlsx';
import { classifyProduct, type FuelTransaction } from './model';
import { extractFleetCode, headerKey, normalizeImmat, parseDate, parseNumber, stableHash } from './normalize';

export interface DkvSheetReport {
  sheet: string;
  rows: number;
  kept: number;
  /** Colonnes reconnues, pour affichage a l'utilisateur. */
  mapped: string[];
  missing: string[];
}

export interface DkvParseResult {
  fileName: string;
  transactions: FuelTransaction[];
  sheets: DkvSheetReport[];
  warnings: string[];
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Alias de colonnes. Les trois exports fournis ont des intitules, un ordre et un
 * nombre de colonnes differents ; seule une detection par nom est fiable.
 */
const COLUMNS = {
  immat: ['ndimmatriculation', 'nodimmatriculation', 'numerodimmatriculation', 'immatriculation', 'immat'],
  date: ['tempsdetransaction', 'datedetransaction', 'datetransaction', 'date', 'dateheure'],
  productGroup: ['groupedeproduits', 'groupeproduit', 'groupedeproduit'],
  productType: ['typedemarchandise', 'typemarchandise', 'designation', 'libelleproduit'],
  volume: ['volume', 'quantite', 'qte'],
  unit: ['unite'],
  price: ['prixalunite', 'prixunitaire'],
  amount: ['valeurtotalenette', 'valeurdachatnette', 'valeurdebasenet', 'montantnet', 'valeurtotalebrute'],
  odometer: ['kilometrage', 'km', 'compteur'],
  card: ['nodecarteboite', 'numerodecarteboite', 'numerocarte', 'nodecarte', 'carte'],
  // Le code flotte numerique se loge selon les exports dans « Centre de couts 2 »
  // ou dans « Information complementaire ». « Centre de cout » sans numero, lui,
  // porte un libelle de service (LOGISTIQUE, LIVRAISON) et non un code.
  costCenter2: ['centredecouts2', 'centredecout2', 'informationcomplementaire'],
  costCenter1: ['centredecouts1', 'centredecout1', 'centredecouts', 'centredecout'],
  city: ['localite', 'villedelastation', 'ville'],
  station: ['nomdelareseau', 'nomdureseau', 'reseau', 'numerodestation'],
} as const;

type ColumnName = keyof typeof COLUMNS;

/** Colonnes sans lesquelles une feuille n'est pas exploitable. */
const REQUIRED: ColumnName[] = ['immat', 'volume', 'productGroup'];

function mapColumns(header: unknown[]): Partial<Record<ColumnName, number>> {
  const keys = header.map(headerKey);
  const map: Partial<Record<ColumnName, number>> = {};
  const taken = new Set<number>();
  // Deux passes : correspondance exacte prioritaire, puis correspondance par prefixe.
  for (const [name, aliases] of Object.entries(COLUMNS) as Array<[ColumnName, readonly string[]]>) {
    const idx = keys.findIndex((k, i) => k && !taken.has(i) && aliases.includes(k));
    if (idx >= 0) {
      map[name] = idx;
      taken.add(idx);
    }
  }
  for (const [name, aliases] of Object.entries(COLUMNS) as Array<[ColumnName, readonly string[]]>) {
    if (map[name] != null) continue;
    const idx = keys.findIndex(
      (k, i) => k && !taken.has(i) && aliases.some((a) => a.length > 4 && k.startsWith(a)),
    );
    if (idx >= 0) {
      map[name] = idx;
      taken.add(idx);
    }
  }
  return map;
}

/**
 * Trouve la ligne d'en-tete : certains exports ajoutent des lignes de titre.
 * On retient, parmi les 12 premieres lignes, celle qui reconnait le plus de colonnes.
 */
function findHeaderRow(rows: unknown[][]): { index: number; map: Partial<Record<ColumnName, number>> } | null {
  let best: { index: number; map: Partial<Record<ColumnName, number>>; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const map = mapColumns(rows[i] ?? []);
    const score = Object.keys(map).length;
    if (REQUIRED.every((r) => map[r] != null) && (!best || score > best.score)) {
      best = { index: i, map, score };
    }
  }
  return best ? { index: best.index, map: best.map } : null;
}

/** Lit un classeur DKV et en extrait les transactions, toutes feuilles confondues. */
export function parseDkvWorkbook(data: ArrayBuffer, fileName: string): DkvParseResult {
  const warnings: string[] = [];
  const transactions: FuelTransaction[] = [];
  const sheets: DkvSheetReport[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: false, raw: true });
  } catch (err) {
    return {
      fileName,
      transactions: [],
      sheets: [],
      warnings: [`Fichier illisible : ${(err as Error).message}`],
      periodStart: null,
      periodEnd: null,
    };
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    if (rows.length < 2) continue;

    const found = findHeaderRow(rows);
    if (!found) {
      sheets.push({ sheet: sheetName, rows: rows.length - 1, kept: 0, mapped: [], missing: REQUIRED });
      warnings.push(`Feuille « ${sheetName} » ignorée : aucune ligne d'en-tête reconnue.`);
      continue;
    }

    const { index: headerIndex, map } = found;
    const cell = (row: unknown[], name: ColumnName): unknown => {
      const i = map[name];
      return i == null ? null : row[i];
    };

    let kept = 0;
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((v) => v == null || v === '')) continue;

      const rawImmat = String(cell(row, 'immat') ?? '').trim();
      const productGroup = String(cell(row, 'productGroup') ?? '').trim();
      const productType = String(cell(row, 'productType') ?? '').trim();
      const volume = parseNumber(cell(row, 'volume')) ?? 0;
      const card = String(cell(row, 'card') ?? '').trim();
      const date = parseDate(cell(row, 'date'));

      // Une ligne sans aucun identifiant ni produit n'est pas une transaction.
      if (!rawImmat && !card && !productGroup) continue;

      const fleetCode =
        extractFleetCode(cell(row, 'costCenter2')) || extractFleetCode(cell(row, 'costCenter1')) || '';

      const tx: FuelTransaction = {
        id: stableHash([
          card,
          rawImmat,
          date ? date.getTime() : '',
          volume,
          productGroup,
          parseNumber(cell(row, 'amount')) ?? '',
        ]),
        sourceFile: fileName,
        sourceSheet: sheetName,
        sourceRow: r + 1,
        card,
        rawImmat,
        declaredImmat: normalizeImmat(rawImmat),
        fleetCode,
        date,
        productGroup,
        productType,
        family: classifyProduct(productGroup, productType),
        volume,
        unit: String(cell(row, 'unit') ?? '').trim(),
        amount: parseNumber(cell(row, 'amount')),
        odometer: parseNumber(cell(row, 'odometer')),
        city: String(cell(row, 'city') ?? '').trim(),
        station: String(cell(row, 'station') ?? '').trim(),
      };
      transactions.push(tx);
      kept++;
    }

    sheets.push({
      sheet: sheetName,
      rows: rows.length - headerIndex - 1,
      kept,
      mapped: Object.keys(map),
      missing: (Object.keys(COLUMNS) as ColumnName[]).filter((c) => map[c] == null),
    });
  }

  if (!transactions.length) warnings.push('Aucune transaction exploitable trouvée dans ce fichier.');

  const dates = transactions.map((t) => t.date).filter((d): d is Date => d != null);
  const periodStart = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const periodEnd = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  return { fileName, transactions, sheets, warnings, periodStart, periodEnd };
}

/** Deduplique les transactions : les exports mensuels se chevauchent parfois. */
export function dedupeTransactions(transactions: FuelTransaction[]): {
  unique: FuelTransaction[];
  duplicates: FuelTransaction[];
} {
  const byId = new Map<string, FuelTransaction>();
  const duplicates: FuelTransaction[] = [];
  for (const tx of transactions) {
    const existing = byId.get(tx.id);
    if (existing) {
      // Un doublon strict provient de deux fichiers qui se recouvrent.
      duplicates.push(tx);
    } else {
      byId.set(tx.id, tx);
    }
  }
  return { unique: [...byId.values()], duplicates };
}
