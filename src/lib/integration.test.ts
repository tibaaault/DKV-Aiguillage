import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRecap, runEngine } from './engine';
import { detectAnomalies } from './anomalies';
import { dedupeTransactions, parseDkvWorkbook } from './parseDkv';
import { decodeText, parseKmFile } from './parseKm';
import { emptyState } from './storage';
import { DEFAULT_SETTINGS } from './model';

/**
 * Ces tests s'executent sur les fichiers reels places a la racine du projet.
 * Ils sont ignores automatiquement quand ces fichiers sont absents : ils ne sont
 * pas versionnes, puisqu'ils contiennent des donnees d'entreprise.
 */
const ROOT = path.resolve(__dirname, '..', '..');

function findFiles(pattern: RegExp): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT)
    .filter((f) => pattern.test(f))
    .map((f) => path.join(ROOT, f));
}

const kmFiles = findFiles(/TICPE.*\.txt$/i);
const dkvFiles = findFiles(/^DKV.*\.xlsx$/i);
const available = kmFiles.length > 0 && dkvFiles.length > 0;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe.skipIf(!available)('chaine complete sur les fichiers reels', () => {
  const kmResult = available
    ? parseKmFile(decodeText(toArrayBuffer(fs.readFileSync(kmFiles[0]))), path.basename(kmFiles[0]))
    : null;

  const dkvResults = dkvFiles.map((f) =>
    parseDkvWorkbook(toArrayBuffer(fs.readFileSync(f)), path.basename(f)),
  );

  it('lit tous les camions du releve kilometrique', () => {
    expect(kmResult!.records.length).toBeGreaterThanOrEqual(10);
    // Le fichier fourni couvre le premier trimestre 2026.
    expect(kmResult!.periodStart?.getUTCFullYear()).toBe(2026);
  });

  it('lit chaque export DKV malgre des colonnes differentes', () => {
    for (const r of dkvResults) {
      expect(r.transactions.length, `${r.fileName} doit contenir des transactions`).toBeGreaterThan(100);
      // La colonne volume s'appelle « Volume » dans deux fichiers et « Quantité » dans le troisieme.
      expect(r.transactions.some((t) => t.volume > 0)).toBe(true);
      expect(r.transactions.some((t) => t.family === 'gazole')).toBe(true);
    }
  });

  it('normalise les immatriculations ecrites differemment', () => {
    const all = dkvResults.flatMap((r) => r.transactions);
    // « FV193CR » et « FV-193-CR » coexistent dans les exports.
    const raw = new Set(all.map((t) => t.rawImmat.replace(/\s/g, '')));
    expect(raw.has('FV193CR') || raw.has('FV-193-CR')).toBe(true);
    const normalized = all.filter((t) => t.declaredImmat === 'FV193CR');
    expect(normalized.length).toBeGreaterThan(0);
  });

  it('ecarte les libelles qui ne sont pas des immatriculations', () => {
    const all = dkvResults.flatMap((r) => r.transactions);
    const relais = all.filter((t) => /RELAIS/i.test(t.rawImmat));
    for (const t of relais) expect(t.declaredImmat).toBe('');
  });

  it('confirme que les exports couvrent le trimestre du releve', () => {
    const engine = runEngine({
      kmRecords: kmResult!.records,
      transactions: dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique,
      state: emptyState(),
    });
    const anomalies = detectAnomalies(
      engine,
      computeRecap(engine, emptyState()),
      DEFAULT_SETTINGS,
      [],
    );
    // Les fichiers en place couvrent le bon trimestre : aucune alerte de periode.
    // La detection elle-meme est couverte par les tests unitaires du moteur.
    expect(anomalies.filter((a) => a.code === 'hors-periode')).toHaveLength(0);
  });

  it('rattache la carte anonyme « RELAIS 1 » a un camion via les compteurs', () => {
    const transactions = dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique;
    const relais = transactions.filter((t) => /RELAIS/i.test(t.rawImmat));
    expect(relais.length).toBeGreaterThan(0);
    // Aucune de ces lignes n'a d'immatriculation exploitable.
    for (const t of relais) expect(t.declaredImmat).toBe('');

    const engine = runEngine({ kmRecords: kmResult!.records, transactions, state: emptyState() });
    const anomalies = detectAnomalies(engine, computeRecap(engine, emptyState()), DEFAULT_SETTINGS, []);

    const orphan = anomalies.find((a) => a.title.includes('RELAIS 1'));
    expect(orphan?.severity).toBe('critique');
    // Les compteurs saisis designent un camion precis du perimetre.
    expect(orphan?.suggestion?.kind).toBe('reassign');
    expect(orphan?.suggestion?.targetImmat).toBeTruthy();
  });

  it('repere les pleins dont le compteur ne correspond a aucun camion du perimetre', () => {
    const engine = runEngine({
      kmRecords: kmResult!.records,
      transactions: dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique,
      state: emptyState(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, emptyState()), DEFAULT_SETTINGS, []);
    const orphanOdo = anomalies.filter((a) => a.title.includes("compteur d'un véhicule inconnu"));
    expect(orphanOdo.length).toBeGreaterThan(0);
    // Ces lignes doivent pouvoir etre sorties du calcul en un clic.
    expect(orphanOdo[0].suggestion?.kind).toBe('ignore');
  });

  it('repere les camions qui roulent sans aucun plein a leur nom', () => {
    const engine = runEngine({
      kmRecords: kmResult!.records,
      transactions: dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique,
      state: emptyState(),
    });
    const recap = computeRecap(engine, emptyState());
    const anomalies = detectAnomalies(engine, recap, DEFAULT_SETTINGS, []);

    const sansCarburant = anomalies.filter((a) => a.code === 'km-sans-carburant').map((a) => a.immat);
    // FL-575-GQ et HF-253-MN ont roule sans qu'aucun plein ne leur soit rattache.
    expect(sansCarburant).toContain('FL575GQ');
    expect(sansCarburant).toContain('HF253MN');
  });

  it('propose de reaffecter a HF-253-MN les pleins dont le compteur correspond', () => {
    const engine = runEngine({
      kmRecords: kmResult!.records,
      transactions: dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique,
      state: emptyState(),
    });
    const recap = computeRecap(engine, emptyState());
    const anomalies = detectAnomalies(engine, recap, DEFAULT_SETTINGS, []);

    const hf = anomalies.find((a) => a.code === 'km-sans-carburant' && a.immat === 'HF253MN');
    expect(hf?.suggestion?.kind).toBe('reassign');
    expect(hf?.suggestion?.targetImmat).toBe('HF253MN');
    expect(hf!.suggestion!.transactionIds.length).toBeGreaterThan(3);
  });

  it('produit un recapitulatif couvrant tous les camions du perimetre', () => {
    const engine = runEngine({
      kmRecords: kmResult!.records,
      transactions: dedupeTransactions(dkvResults.flatMap((r) => r.transactions)).unique,
      state: emptyState(),
    });
    const recap = computeRecap(engine, emptyState());
    expect(recap.length).toBeGreaterThanOrEqual(kmResult!.records.length);
    // Les litres retenus ne comptent que le gazole.
    const totalGazole = engine.resolved
      .filter((t) => t.family === 'gazole' && t.assignedImmat)
      .reduce((s, t) => s + t.volume, 0);
    const totalRecap = recap.reduce((s, r) => s + r.litres, 0);
    expect(totalRecap).toBeCloseTo(
      totalGazole -
        engine.resolved
          .filter((t) => t.family === 'gazole' && t.assignedImmat && !engine.vehicles.get(t.assignedImmat)?.ticpe)
          .reduce((s, t) => s + t.volume, 0),
      1,
    );
  });
});
