import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from './exportXlsx';
import { DEFAULT_SETTINGS, type Anomaly, type RecapRow, type ResolvedTransaction } from './model';

const recap: RecapRow[] = [
  {
    immat: 'FT209WB',
    label: 'FT-209-WB',
    region: 'HAUTS DE FRANCE',
    category: 'LD',
    fleetCode: '96501',
    kmStart: 254776,
    kmEnd: 264790,
    km: 10014,
    litres: 3327.4,
    adblue: 180.5,
    conso: 33.23,
    txCount: 24,
    edited: false,
    history: [{ quarter: '2025-T4', conso: 29.76 }],
    flags: [],
  },
  {
    immat: 'HF253MN',
    label: 'HF-253-MN',
    region: 'HAUTS DE FRANCE',
    category: 'MD',
    fleetCode: '126314',
    kmStart: 11428,
    kmEnd: 28636,
    km: 17208,
    litres: 0,
    adblue: 0,
    conso: null,
    txCount: 0,
    edited: true,
    history: [{ quarter: '2025-T4', conso: null }],
    flags: [],
  },
];

const transactions: ResolvedTransaction[] = [
  {
    id: 'a',
    sourceFile: 'DKV 01-2026.xlsx',
    sourceSheet: 'Sheet0',
    sourceRow: 9,
    card: '70431001077057982',
    rawImmat: 'FT-209-WB',
    declaredImmat: 'FT209WB',
    fleetCode: '96501',
    date: new Date('2026-01-02T12:44:00Z'),
    productGroup: 'Gazole',
    productType: 'Gazole',
    family: 'gazole',
    volume: 97.02,
    unit: 'L',
    amount: 129.74,
    odometer: 255170,
    city: 'Wasquehal',
    station: 'DKV',
    assignedImmat: 'FT209WB',
    assignmentSource: 'declaree',
    reassigned: false,
  },
  {
    id: 'b',
    sourceFile: 'DKV 01-2026.xlsx',
    sourceSheet: 'Sheet0',
    sourceRow: 7,
    card: '70431001119851251',
    rawImmat: 'DR945HP',
    declaredImmat: 'DR945HP',
    fleetCode: '',
    date: new Date('2026-01-02T12:10:00Z'),
    productGroup: 'Gazole',
    productType: 'Gazole',
    family: 'gazole',
    volume: 155.08,
    unit: 'L',
    amount: 207.38,
    odometer: 11806,
    city: 'Wasquehal',
    station: 'DKV',
    assignedImmat: 'HF253MN',
    assignmentSource: 'manuelle',
    reassigned: true,
  },
];

const anomalies: Anomaly[] = [
  {
    id: 'x',
    code: 'km-sans-carburant',
    severity: 'critique',
    title: 'HF-253-MN a parcouru 17 208 km sans aucun plein à son nom',
    detail: 'Signature typique d un échange de carte.',
    immat: 'HF253MN',
    transactionIds: ['b'],
  },
];

async function generate(): Promise<XLSX.WorkBook> {
  const blob = await buildWorkbook({
    recap,
    transactions,
    anomalies,
    settings: DEFAULT_SETTINGS,
    periodLabel: '2026-T1 (02/01/2026 → 31/03/2026)',
    sourceFiles: ['Kilométrages Camion TICPE.txt', 'DKV 01-2026.xlsx'],
  });
  return XLSX.read(await blob.arrayBuffer(), { type: 'array' });
}

describe('buildWorkbook', () => {
  it('produit un classeur relisible avec les quatre onglets attendus', async () => {
    const wb = await generate();
    expect(wb.SheetNames).toEqual(['Récapitulatif', 'Détail transactions', 'Anomalies', 'Méthode']);
  });

  it('reporte les valeurs du recapitulatif', async () => {
    const wb = await generate();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Récapitulatif'], {
      header: 1,
      range: 3,
    }) as unknown as unknown[][];

    const header = rows[0].map(String);
    expect(header).toContain('IMMATRICULATION');
    expect(header).toContain('LITRES GAZOLE');
    // La colonne d'historique du trimestre archive doit apparaitre.
    expect(header.some((h) => h.includes('2025-T4'))).toBe(true);

    const ft = rows.find((r) => r[1] === 'FT-209-WB');
    expect(ft?.[6]).toBe(10014);
    expect(ft?.[7]).toBeCloseTo(3327.4, 2);
    expect(ft?.[8]).toBeCloseTo(33.23, 2);

    // Le camion sans plein doit porter une observation explicite.
    const hf = rows.find((r) => r[1] === 'HF-253-MN');
    expect(String(hf?.[hf!.length - 1])).toContain('aucun plein rattaché');
  });

  it('totalise les kilometres et les litres', async () => {
    const wb = await generate();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Récapitulatif'], { header: 1, range: 3 });
    const total = rows.find((r) => r[1] === 'TOTAL');
    expect(total?.[6]).toBe(10014 + 17208);
    expect(total?.[7]).toBeCloseTo(3327.4, 2);
  });

  it('trace l origine de chaque affectation dans le detail', async () => {
    const wb = await generate();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Détail transactions']);
    const reassigned = rows.find((r) => r['Immat. déclarée'] === 'DR945HP');
    expect(reassigned?.['Immat. retenue']).toBe('HF-253-MN');
    expect(reassigned?.['Origine affectation']).toBe('manuelle');
    expect(reassigned?.['Réaffecté']).toBe('OUI');
  });

  it('conserve le numero de carte en texte', async () => {
    const wb = await generate();
    const sheet = wb.Sheets['Détail transactions'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    // Un numero de 17 chiffres perdrait sa precision s'il etait stocke en nombre.
    expect(String(rows[0]['Carte'])).toMatch(/^\d{17}$/);
  });

  it('liste les anomalies et documente la methode', async () => {
    const wb = await generate();
    const anomalyRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Anomalies']);
    expect(anomalyRows[0]['Gravité']).toBe('critique');
    expect(String(anomalyRows[0]['Constat'])).toContain('HF-253-MN');

    const method = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Méthode'], { header: 1 });
    const flat = method.flat().map(String).join(' | ');
    expect(flat).toContain('Gazole uniquement');
    expect(flat).toContain('Kilométrages Camion TICPE.txt');
  });
});
