import type { Cell, Row, Workbook } from 'exceljs';
import type { Anomaly, RecapRow, ResolvedTransaction, Settings } from './model';
import { FAMILY_LABEL } from './model';
import { formatDateTime, formatImmat } from './normalize';

export interface ExportInput {
  recap: RecapRow[];
  transactions: ResolvedTransaction[];
  anomalies: Anomaly[];
  settings: Settings;
  periodLabel: string;
  sourceFiles: string[];
}

const HEADER_FILL = 'FF1F3864';
const ACCENT_FILL = 'FFDCE6F1';
const WARN_FILL = 'FFFFF2CC';
const BAD_FILL = 'FFF8CBAD';
const EDIT_FILL = 'FFE2EFDA';

function styleHeaderRow(row: Row, fill = HEADER_FILL): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      left: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      right: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
  row.height = 34;
}

function thinBorders(cell: Cell): void {
  cell.border = {
    top: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    left: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    right: { style: 'hair', color: { argb: 'FFCCCCCC' } },
  };
}

/**
 * Genere le classeur de restitution : recapitulatif, detail, anomalies, methode.
 * ExcelJS est charge a la demande : il pese pres d'un mega-octet et n'est utile
 * qu'au moment du telechargement.
 */
export async function buildWorkbook(input: ExportInput): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DKV Aiguillage';
  wb.created = new Date();

  buildRecapSheet(wb, input);
  buildTransactionsSheet(wb, input);
  buildAnomaliesSheet(wb, input);
  buildMethodSheet(wb, input);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function buildRecapSheet(wb: Workbook, { recap, periodLabel, settings }: ExportInput): void {
  const ws = wb.addWorksheet('Récapitulatif', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const quarters = recap[0]?.history.map((h) => h.quarter) ?? [];

  ws.mergeCells(1, 1, 1, 10);
  const title = ws.getCell(1, 1);
  title.value = `CONSOLIDATION TICPE — ${periodLabel}`;
  title.font = { bold: true, size: 14, color: { argb: HEADER_FILL } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, 10);
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `Consommation calculée sur le gazole uniquement. Édité le ${formatDateTime(new Date())}.`;
  subtitle.font = { italic: true, size: 9, color: { argb: 'FF666666' } };

  const headers = [
    'RÉGION',
    'IMMATRICULATION',
    'CODE FLOTTE',
    'CAT.',
    'KM DÉBUT',
    'KM FIN',
    'KM PARCOURUS',
    'LITRES GAZOLE',
    `CONSO L/100 ${periodLabel}`,
    'ADBLUE (L)',
    'NB PLEINS',
    ...quarters.map((q) => `CONSO ${q}`),
    'OBSERVATION',
  ];

  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);
  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: headers.length } };

  for (const row of recap) {
    const observation: string[] = [];
    if (row.edited) observation.push('valeur corrigée manuellement');
    if (row.litres === 0 && (row.km ?? 0) > 0) observation.push('aucun plein rattaché');
    if (row.conso != null && (row.conso < settings.consoMin || row.conso > settings.consoMax)) {
      observation.push('consommation hors plage attendue');
    }

    const added = ws.addRow([
      row.region,
      row.label,
      row.fleetCode,
      row.category,
      row.kmStart,
      row.kmEnd,
      row.km,
      round(row.litres, 2),
      row.conso != null ? round(row.conso, 2) : null,
      round(row.adblue, 2),
      row.txCount,
      ...row.history.map((h) => (h.conso != null ? round(h.conso, 2) : null)),
      observation.join(' ; '),
    ]);

    added.eachCell({ includeEmpty: true }, (cell) => {
      thinBorders(cell);
      cell.font = { size: 10 };
    });
    added.getCell(5).numFmt = '# ##0';
    added.getCell(6).numFmt = '# ##0';
    added.getCell(7).numFmt = '# ##0';
    added.getCell(8).numFmt = '# ##0.00';
    added.getCell(10).numFmt = '# ##0.00';
    for (let c = 9; c <= 9 + quarters.length; c++) {
      if (c === 10 || c === 11) continue;
      added.getCell(c).numFmt = '0.00';
    }
    added.getCell(9).numFmt = '0.00';
    added.getCell(9).font = { size: 10, bold: true };
    for (let c = 12; c <= 11 + quarters.length; c++) added.getCell(c).numFmt = '0.00';

    if (row.edited) {
      added.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
      added.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
    }
    if (row.litres === 0 && (row.km ?? 0) > 0) {
      added.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAD_FILL } };
    } else if (row.conso != null && (row.conso < settings.consoMin || row.conso > settings.consoMax)) {
      added.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_FILL } };
    }
  }

  // Ligne de totaux.
  const totalKm = recap.reduce((s, r) => s + (r.km ?? 0), 0);
  const totalL = recap.reduce((s, r) => s + r.litres, 0);
  const totalRow = ws.addRow([
    '',
    'TOTAL',
    '',
    '',
    null,
    null,
    totalKm,
    round(totalL, 2),
    totalKm > 0 ? round((totalL / totalKm) * 100, 2) : null,
    round(recap.reduce((s, r) => s + r.adblue, 0), 2),
    recap.reduce((s, r) => s + r.txCount, 0),
  ]);
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
    thinBorders(cell);
  });
  totalRow.getCell(7).numFmt = '# ##0';
  totalRow.getCell(8).numFmt = '# ##0.00';
  totalRow.getCell(9).numFmt = '0.00';
  totalRow.getCell(10).numFmt = '# ##0.00';

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 22 : i === 1 ? 17 : i === headers.length - 1 ? 38 : 13;
  });
}

function buildTransactionsSheet(wb: Workbook, { transactions }: ExportInput): void {
  const ws = wb.addWorksheet('Détail transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = [
    'Date',
    'Immat. déclarée',
    'Immat. retenue',
    'Origine affectation',
    'Réaffecté',
    'Produit',
    'Volume',
    'Unité',
    'Montant net',
    'Compteur saisi',
    'Carte',
    'Code flotte',
    'Ville',
    'Réseau',
    'Fichier source',
    'Ligne',
  ];
  styleHeaderRow(ws.addRow(headers));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const sorted = [...transactions].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  for (const tx of sorted) {
    const row = ws.addRow([
      tx.date ?? null,
      tx.rawImmat,
      tx.assignedImmat ? formatImmat(tx.assignedImmat) : '— non rattaché —',
      tx.assignmentSource,
      tx.reassigned ? 'OUI' : '',
      `${FAMILY_LABEL[tx.family]}${tx.productType ? ` — ${tx.productType}` : ''}`,
      round(tx.volume, 2),
      tx.unit,
      tx.amount,
      tx.odometer,
      tx.card,
      tx.fleetCode,
      tx.city,
      tx.station,
      tx.sourceFile,
      tx.sourceRow,
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      thinBorders(cell);
      cell.font = { size: 9 };
    });
    row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(7).numFmt = '# ##0.00';
    row.getCell(9).numFmt = '# ##0.00';
    row.getCell(10).numFmt = '# ##0';
    if (tx.reassigned) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
    }
    if (!tx.assignedImmat) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAD_FILL } };
    }
    // Le numero de carte est un identifiant, pas un nombre.
    row.getCell(11).numFmt = '@';
  }

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 17 : [1, 2, 3, 5].includes(i) ? 16 : i === 10 ? 21 : 13;
  });
}

function buildAnomaliesSheet(wb: Workbook, { anomalies }: ExportInput): void {
  const ws = wb.addWorksheet('Anomalies', { views: [{ state: 'frozen', ySplit: 1 }] });
  styleHeaderRow(ws.addRow(['Gravité', 'Type', 'Véhicule', 'Constat', 'Explication', 'Lignes concernées']));

  for (const a of anomalies) {
    const row = ws.addRow([
      a.severity,
      a.code,
      a.immat ? formatImmat(a.immat) : '',
      a.title,
      a.detail,
      a.transactionIds?.length ?? 0,
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      thinBorders(cell);
      cell.font = { size: 9 };
      cell.alignment = { vertical: 'top', wrapText: true };
    });
    const fill =
      a.severity === 'critique' ? BAD_FILL : a.severity === 'avertissement' ? WARN_FILL : ACCENT_FILL;
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    row.getCell(1).font = { size: 9, bold: true };
  }

  ws.columns = [
    { width: 15 },
    { width: 22 },
    { width: 15 },
    { width: 55 },
    { width: 80 },
    { width: 12 },
  ];
}

function buildMethodSheet(wb: Workbook, { settings, sourceFiles, periodLabel, transactions }: ExportInput): void {
  const ws = wb.addWorksheet('Méthode');
  ws.columns = [{ width: 34 }, { width: 90 }];

  const lines: Array<[string, string]> = [
    ['Période traitée', periodLabel],
    ['Édité le', formatDateTime(new Date())],
    ['Fichiers sources', sourceFiles.join('\n')],
    ['Transactions analysées', String(transactions.length)],
    ['', ''],
    ['Litres retenus', 'Gazole uniquement. AdBlue, essence, péages et frais divers sont exclus du calcul de consommation.'],
    ['Kilomètres retenus', 'Relevé kilométrique TICPE. Toute correction manuelle est signalée en vert dans le récapitulatif.'],
    ['Calcul de la consommation', 'Litres de gazole ÷ kilomètres parcourus × 100.'],
    ['Plage de consommation attendue', `${settings.consoMin} à ${settings.consoMax} L/100 km`],
    ['Tolérance sur les compteurs', `± ${settings.odometerTolerance} km autour de la plage du véhicule`],
    ['', ''],
    [
      'Ordre de rattachement des pleins',
      "1. Correction manuelle ponctuelle\n2. Règle de correction en masse\n3. Immatriculation lisible et connue\n4. Code flotte (centre de coûts)\n5. Numéro de carte carburant",
    ],
    [
      'Détection des échanges de cartes',
      "Le kilométrage saisi à la pompe est comparé à la plage kilométrique de chaque camion, interpolée à la date du plein. Un plein dont le compteur ne correspond pas au véhicule déclaré mais tombe dans la plage d'un autre camion est signalé.",
    ],
    ['Confidentialité', "Tous les calculs sont effectués dans le navigateur. Aucun fichier n'est transmis sur Internet."],
  ];

  for (const [label, value] of lines) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).font = { size: 10 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).alignment = { vertical: 'top' };
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
