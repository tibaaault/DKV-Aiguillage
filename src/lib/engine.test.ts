import { describe, expect, it } from 'vitest';
import { computeRecap, learnCardMap, odometerScore, resolveTransactions, runEngine, suggestVehicles } from './engine';
import { detectAnomalies } from './anomalies';
import {
  classifyProduct,
  DEFAULT_SETTINGS,
  EXCLUDED_IMMAT,
  type FuelTransaction,
  type KmRecord,
  type PersistedState,
} from './model';
import { emptyState } from './storage';

function km(immat: string, kmStart: number, kmEnd: number, from = '2026-01-01', to = '2026-03-31'): KmRecord {
  return {
    immat,
    rawImmat: immat,
    fleetCode: '',
    start: new Date(`${from}T00:00:00Z`),
    end: new Date(`${to}T00:00:00Z`),
    kmStart,
    kmEnd,
    km: kmEnd - kmStart,
    sourceLine: 1,
  };
}

let counter = 0;
function tx(partial: Partial<FuelTransaction>): FuelTransaction {
  counter += 1;
  return {
    id: `tx${counter}`,
    sourceFile: 'test.xlsx',
    sourceSheet: 'Sheet0',
    sourceRow: counter,
    card: '',
    rawImmat: '',
    declaredImmat: '',
    fleetCode: '',
    date: new Date('2026-02-01T10:00:00Z'),
    productGroup: 'Gazole',
    productType: 'Gazole',
    family: 'gazole',
    volume: 100,
    unit: 'L',
    amount: 140,
    odometer: null,
    city: '',
    station: '',
    ...partial,
  };
}

const state = (patch: Partial<PersistedState> = {}): PersistedState => ({ ...emptyState(), ...patch });

describe('classifyProduct', () => {
  it('range chaque groupe DKV dans la bonne famille', () => {
    expect(classifyProduct('Gazole', 'Gazole')).toBe('gazole');
    expect(classifyProduct('AdBlue', 'AdBlue (en vrac)')).toBe('adblue');
    expect(classifyProduct('Essence', 'Essence - RON 95 - E10')).toBe('essence');
    expect(classifyProduct('Frais de péage', 'Libert-t - Péage FR')).toBe('peage');
    expect(classifyProduct('Parking', '')).toBe('autre');
  });
});

describe('learnCardMap', () => {
  it('retient l immat majoritaire vue sur une carte', () => {
    const vehicles = new Map();
    const transactions = [
      tx({ card: 'C1', declaredImmat: 'FT209WB' }),
      tx({ card: 'C1', declaredImmat: 'FT209WB' }),
      tx({ card: 'C1', declaredImmat: 'FT299XX' }),
    ];
    expect(learnCardMap(transactions, vehicles).get('C1')).toBe('FT209WB');
  });
});

describe('resolveTransactions', () => {
  it('applique l ordre de priorite des sources d affectation', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790), km('FL575GQ', 258990, 263522)],
      transactions: [
        tx({ declaredImmat: 'FT209WB', rawImmat: 'FT-209-WB' }),
        tx({ declaredImmat: '', rawImmat: 'RELAIS 1', fleetCode: '96501' }),
        tx({ declaredImmat: '', rawImmat: '', card: 'C9' }),
      ],
      state: state(),
    });
    expect(engine.resolved[0].assignmentSource).toBe('declaree');
    expect(engine.resolved[1].assignmentSource).toBe('aucune');
    expect(engine.resolved[2].assignmentSource).toBe('aucune');
  });

  it('privilegie la correction manuelle sur tout le reste', () => {
    const vehicles = new Map([
      ['FT209WB', { immat: 'FT209WB', label: 'FT-209-WB', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
      ['FL575GQ', { immat: 'FL575GQ', label: 'FL-575-GQ', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
    ]);
    const t = tx({ declaredImmat: 'FT209WB' });
    const [resolved] = resolveTransactions([t], vehicles, new Map(), [], { [t.id]: 'FL575GQ' });
    expect(resolved.assignedImmat).toBe('FL575GQ');
    expect(resolved.assignmentSource).toBe('manuelle');
    expect(resolved.reassigned).toBe(true);
  });

  it('exclut du calcul une transaction marquee comme telle', () => {
    const vehicles = new Map([
      ['FT209WB', { immat: 'FT209WB', label: 'FT-209-WB', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
    ]);
    const t = tx({ declaredImmat: 'FT209WB', volume: 500 });
    const [resolved] = resolveTransactions([t], vehicles, new Map(), [], { [t.id]: EXCLUDED_IMMAT });
    expect(resolved.assignedImmat).toBe('');
    expect(resolved.assignmentSource).toBe('manuelle');

    // Une ligne exclue ne doit alimenter aucun total.
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [t],
      state: state({ overrides: { [t.id]: EXCLUDED_IMMAT } }),
    });
    expect(computeRecap(engine, state())[0].litres).toBe(0);
  });

  it('revient a l affectation automatique quand la correction est retiree', () => {
    const vehicles = new Map([
      ['FT209WB', { immat: 'FT209WB', label: 'FT-209-WB', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
    ]);
    const t = tx({ declaredImmat: 'FT209WB' });
    // Une chaine vide n'est pas une exclusion : c'est l'absence de correction.
    const [resolved] = resolveTransactions([t], vehicles, new Map(), [], { [t.id]: '' });
    expect(resolved.assignedImmat).toBe('FT209WB');
    expect(resolved.assignmentSource).toBe('declaree');
  });

  it('applique une regle de correction en masse sur une periode', () => {
    const vehicles = new Map([
      ['DR945HP', { immat: 'DR945HP', label: 'DR-945-HP', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
      ['HF253MN', { immat: 'HF253MN', label: 'HF-253-MN', fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true }],
    ]);
    const rule = {
      id: 'r1',
      enabled: true,
      label: 'echange de carte',
      matchField: 'card' as const,
      matchValue: 'CARD1',
      dateFrom: '2026-01-15',
      dateTo: '2026-02-15',
      family: 'gazole' as const,
      targetImmat: 'HF253MN',
    };
    const inside = tx({ card: 'CARD1', declaredImmat: 'DR945HP', date: new Date('2026-02-01T00:00:00Z') });
    const outside = tx({ card: 'CARD1', declaredImmat: 'DR945HP', date: new Date('2026-03-01T00:00:00Z') });
    const resolved = resolveTransactions([inside, outside], vehicles, new Map(), [rule], {});
    expect(resolved[0].assignedImmat).toBe('HF253MN');
    expect(resolved[0].assignmentSource).toBe('regle');
    expect(resolved[1].assignedImmat).toBe('DR945HP');
  });
});

describe('odometerScore', () => {
  const record = km('HF253MN', 11428, 28636);

  it('note fortement un compteur coherent avec la date', () => {
    // Mi-periode, le camion doit etre a mi-parcours : environ 20 000 km.
    const score = odometerScore(record, 20000, new Date('2026-02-14T12:00:00Z'), 1500);
    expect(score).toBeGreaterThan(0.8);
  });

  it('rejette un compteur hors plage', () => {
    expect(odometerScore(record, 226778, new Date('2026-02-01T00:00:00Z'), 1500)).toBe(0);
  });

  it('accepte dans la tolerance mais pas au-dela', () => {
    expect(odometerScore(record, 11000, new Date('2026-01-05T00:00:00Z'), 1500)).toBeGreaterThan(0);
    expect(odometerScore(record, 9000, new Date('2026-01-05T00:00:00Z'), 1500)).toBe(0);
  });
});

describe('suggestVehicles', () => {
  it('identifie le camion dont la plage correspond au compteur saisi', () => {
    const kmByImmat = new Map([
      ['DR945HP', km('DR945HP', 226778, 228712)],
      ['HF253MN', km('HF253MN', 11428, 28636)],
    ]);
    const vehicles = new Map(
      [...kmByImmat.keys()].map((i) => [
        i,
        { immat: i, label: i, fleetCode: '', region: '', category: '' as const, ticpe: true, auto: true },
      ]),
    );
    // Compteur 11806 : c'est la plage de HF-253-MN, pas celle de DR-945-HP.
    const candidates = suggestVehicles(
      tx({ declaredImmat: 'DR945HP', odometer: 11806, date: new Date('2026-01-05T00:00:00Z') }),
      kmByImmat,
      vehicles,
      DEFAULT_SETTINGS,
      new Map([['DR945HP', 3000]]),
    );
    expect(candidates[0].immat).toBe('HF253MN');
  });
});

describe('computeRecap', () => {
  it('calcule la consommation sur le gazole seul', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [
        tx({ declaredImmat: 'FT209WB', family: 'gazole', volume: 1000 }),
        tx({ declaredImmat: 'FT209WB', family: 'adblue', volume: 60, productGroup: 'AdBlue' }),
        tx({ declaredImmat: 'FT209WB', family: 'peage', volume: 5, productGroup: 'Frais de péage' }),
      ],
      state: state(),
    });
    const [row] = computeRecap(engine, state());
    expect(row.litres).toBe(1000);
    expect(row.adblue).toBe(60);
    expect(row.km).toBe(10014);
    expect(row.conso).toBeCloseTo((1000 / 10014) * 100, 4);
  });

  it('laisse la correction manuelle primer sur le calcul', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [tx({ declaredImmat: 'FT209WB', volume: 1000 })],
      state: state(),
    });
    const withEdit = state({ recapEdits: { FT209WB: { km: 10000, litres: 2500 } } });
    const [row] = computeRecap(engine, withEdit);
    expect(row.km).toBe(10000);
    expect(row.litres).toBe(2500);
    expect(row.conso).toBeCloseTo(25);
    expect(row.edited).toBe(true);
  });

  it('ne calcule pas de consommation sans kilometre', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 254776)],
      transactions: [tx({ declaredImmat: 'FT209WB', volume: 500 })],
      state: state(),
    });
    expect(computeRecap(engine, state())[0].conso).toBeNull();
  });
});

describe('detectAnomalies', () => {
  const settings = DEFAULT_SETTINGS;

  it('signale un camion qui roule sans aucun plein et designe le coupable', () => {
    // DR-945-HP porte les pleins, mais les compteurs saisis sont ceux de HF-253-MN.
    const transactions = [1, 2, 3, 4].map((i) =>
      tx({
        declaredImmat: 'DR945HP',
        rawImmat: 'DR945HP',
        volume: 150,
        odometer: 12000 + i * 3000,
        date: new Date(`2026-0${i}-10T00:00:00Z`),
      }),
    );
    const engine = runEngine({
      kmRecords: [km('DR945HP', 226778, 228712), km('HF253MN', 11428, 28636)],
      transactions,
      state: state(),
    });
    const recap = computeRecap(engine, state());
    const anomalies = detectAnomalies(engine, recap, settings, []);

    const sansCarburant = anomalies.find((a) => a.code === 'km-sans-carburant' && a.immat === 'HF253MN');
    expect(sansCarburant).toBeDefined();
    expect(sansCarburant?.severity).toBe('critique');
    expect(sansCarburant?.suggestion?.targetImmat).toBe('HF253MN');
    expect(sansCarburant?.suggestion?.transactionIds.length).toBeGreaterThan(0);
  });

  it('signale les transactions hors trimestre', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [
        tx({ declaredImmat: 'FT209WB', date: new Date('2026-02-01T00:00:00Z') }),
        tx({ declaredImmat: 'FT209WB', date: new Date('2025-03-15T00:00:00Z') }),
      ],
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);
    const horsPeriode = anomalies.find((a) => a.code === 'hors-periode');
    expect(horsPeriode).toBeDefined();
    expect(horsPeriode?.severity).toBe('critique');
    expect(horsPeriode?.transactionIds).toHaveLength(1);
  });

  it('signale une consommation hors plage', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 0, 1000)],
      transactions: [tx({ declaredImmat: 'FT209WB', volume: 900 })],
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);
    expect(anomalies.some((a) => a.code === 'conso-aberrante')).toBe(true);
  });

  it('signale le gazole consomme hors perimetre TICPE', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [tx({ declaredImmat: 'GJ929CB', rawImmat: 'GJ-929-CB', volume: 500 })],
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);
    expect(anomalies.some((a) => a.code === 'immat-inconnue' && a.immat === 'GJ929CB')).toBe(true);
  });

  it('rattache une carte anonyme au camion designe par les compteurs', () => {
    // Douze pleins sans immatriculation lisible, tous avec le compteur de FT-494-VQ.
    const transactions = Array.from({ length: 12 }, (_, i) =>
      tx({
        rawImmat: 'RELAIS 1',
        declaredImmat: '',
        card: 'CARTE-RELAIS',
        volume: 80,
        odometer: 320000 + i * 800,
        date: new Date(2026, 0, 5 + i * 5),
      }),
    );
    const engine = runEngine({
      kmRecords: [km('FT494VQ', 318729, 330271), km('FT209WB', 254776, 264790)],
      transactions,
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);

    const orphan = anomalies.find((a) => a.title.includes('RELAIS 1'));
    expect(orphan?.severity).toBe('critique');
    expect(orphan?.suggestion?.kind).toBe('reassign');
    expect(orphan?.suggestion?.targetImmat).toBe('FT494VQ');
    expect(orphan?.suggestion?.transactionIds).toHaveLength(12);
  });

  it('ne resignale pas les lignes volontairement exclues', () => {
    const transactions = Array.from({ length: 5 }, () =>
      tx({ rawImmat: 'RELAIS 1', declaredImmat: '', card: 'CARTE-RELAIS', volume: 80, odometer: 320000 }),
    );
    const overrides = Object.fromEntries(transactions.map((t) => [t.id, EXCLUDED_IMMAT]));
    const engine = runEngine({
      kmRecords: [km('FT494VQ', 318729, 330271)],
      transactions,
      state: state({ overrides }),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state({ overrides })), settings, []);
    expect(anomalies.some((a) => a.title.includes('RELAIS 1'))).toBe(false);
  });

  it('signale les pleins dont le compteur ne correspond a aucun camion connu', () => {
    // Compteurs autour de 5 000 km : hors de portee de tous les camions du releve.
    const transactions = Array.from({ length: 4 }, (_, i) =>
      tx({
        declaredImmat: 'EL644CD',
        rawImmat: 'EL 644 CD',
        volume: 110,
        odometer: 4400 + i * 600,
        date: new Date(2026, 2, 20 + i),
      }),
    );
    const engine = runEngine({
      kmRecords: [km('EL644CD', 422445, 431117), km('FT209WB', 254776, 264790)],
      transactions,
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);

    const orphanOdo = anomalies.find((a) => a.title.includes("compteur d'un véhicule inconnu"));
    expect(orphanOdo?.immat).toBe('EL644CD');
    expect(orphanOdo?.severity).toBe('critique');
    // Sans camion candidat, la seule action sensee est de sortir ces litres du calcul.
    expect(orphanOdo?.suggestion?.kind).toBe('ignore');
    expect(orphanOdo?.suggestion?.transactionIds).toHaveLength(4);
  });

  it('ne confond pas un echange de carte avec un compteur orphelin', () => {
    // Ici les compteurs correspondent a un autre camion du releve : c'est une
    // reaffectation qu'il faut proposer, pas une exclusion.
    const transactions = Array.from({ length: 4 }, (_, i) =>
      tx({
        declaredImmat: 'DR945HP',
        volume: 150,
        odometer: 13000 + i * 3000,
        date: new Date(2026, i, 10),
      }),
    );
    const engine = runEngine({
      kmRecords: [km('DR945HP', 226778, 228712), km('HF253MN', 11428, 28636)],
      transactions,
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);
    expect(anomalies.some((a) => a.title.includes("compteur d'un véhicule inconnu"))).toBe(false);
    expect(anomalies.some((a) => a.suggestion?.targetImmat === 'HF253MN')).toBe(true);
  });

  it('ne signale rien sur un jeu de donnees sain', () => {
    const engine = runEngine({
      kmRecords: [km('FT209WB', 254776, 264790)],
      transactions: [
        tx({ declaredImmat: 'FT209WB', volume: 1500, odometer: 256000, date: new Date('2026-01-15T00:00:00Z') }),
        tx({ declaredImmat: 'FT209WB', volume: 1300, odometer: 262000, date: new Date('2026-03-01T00:00:00Z') }),
      ],
      state: state(),
    });
    const anomalies = detectAnomalies(engine, computeRecap(engine, state()), settings, []);
    expect(anomalies).toHaveLength(0);
  });
});
