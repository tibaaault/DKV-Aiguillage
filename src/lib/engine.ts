import {
  EXCLUDED_IMMAT,
  type AssignmentSource,
  type Category,
  type FuelTransaction,
  type KmRecord,
  type PersistedState,
  type ProductFamily,
  type RecapRow,
  type ResolvedTransaction,
  type Rule,
  type Settings,
  type Vehicle,
} from './model';
import { formatImmat } from './normalize';

/** Contexte de calcul assemble a partir des fichiers importes et de l'etat persiste. */
export interface EngineInput {
  kmRecords: KmRecord[];
  transactions: FuelTransaction[];
  state: PersistedState;
}

export interface EngineOutput {
  vehicles: Map<string, Vehicle>;
  kmByImmat: Map<string, KmRecord>;
  resolved: ResolvedTransaction[];
  cardMap: Map<string, string>;
  /** Cartes dont l'immat de rattachement a ete apprise automatiquement. */
  learnedCards: Map<string, string>;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Construit le referentiel vehicules : le releve kilometrique fait foi pour le
 * perimetre TICPE, les immats vues uniquement dans DKV sont ajoutees hors perimetre,
 * et les fiches deja enregistrees par l'utilisateur ecrasent les valeurs deduites.
 */
export function buildRegistry(
  kmRecords: KmRecord[],
  transactions: FuelTransaction[],
  saved: Record<string, Vehicle>,
): Map<string, Vehicle> {
  const vehicles = new Map<string, Vehicle>();

  const ensure = (immat: string, ticpe: boolean): Vehicle => {
    let v = vehicles.get(immat);
    if (!v) {
      v = {
        immat,
        label: formatImmat(immat),
        fleetCode: '',
        region: '',
        category: '' as Category,
        ticpe,
        auto: true,
      };
      vehicles.set(immat, v);
    }
    if (ticpe) v.ticpe = true;
    return v;
  };

  for (const r of kmRecords) {
    const v = ensure(r.immat, true);
    if (r.fleetCode) v.fleetCode = r.fleetCode;
  }
  for (const t of transactions) {
    if (!t.declaredImmat) continue;
    const v = ensure(t.declaredImmat, false);
    if (!v.fleetCode && t.fleetCode) v.fleetCode = t.fleetCode;
  }

  // Les fiches enregistrees priment : ce sont les corrections de l'utilisateur.
  for (const [immat, savedVehicle] of Object.entries(saved)) {
    const existing = vehicles.get(immat);
    vehicles.set(immat, {
      ...(existing ?? savedVehicle),
      ...savedVehicle,
      // Le perimetre TICPE du trimestre en cours vient du releve km, pas de l'historique.
      ticpe: existing ? existing.ticpe || savedVehicle.ticpe : savedVehicle.ticpe,
      auto: false,
    });
  }

  return vehicles;
}

/**
 * Apprend le rattachement carte -> vehicule. Une carte est physiquement liee a un
 * vehicule ; l'immat saisie a la pompe, elle, peut etre fausse. On retient l'immat
 * majoritaire observee sur la carte, en privilegiant les vehicules du perimetre TICPE.
 */
export function learnCardMap(
  transactions: FuelTransaction[],
  vehicles: Map<string, Vehicle>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (!t.card || !t.declaredImmat) continue;
    let inner = counts.get(t.card);
    if (!inner) counts.set(t.card, (inner = new Map()));
    inner.set(t.declaredImmat, (inner.get(t.declaredImmat) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const [card, inner] of counts) {
    let best = '';
    let bestScore = -1;
    for (const [immat, n] of inner) {
      // Un vehicule TICPE l'emporte a nombre d'occurrences comparable.
      const score = n * (vehicles.get(immat)?.ticpe ? 2 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = immat;
      }
    }
    if (best) result.set(card, best);
  }
  return result;
}

function ruleMatches(rule: Rule, tx: FuelTransaction): boolean {
  if (!rule.enabled || !rule.targetImmat) return false;
  const value =
    rule.matchField === 'card' ? tx.card : rule.matchField === 'fleetCode' ? tx.fleetCode : tx.declaredImmat;
  if (!value || value.toUpperCase() !== rule.matchValue.toUpperCase()) return false;
  if (rule.family && tx.family !== rule.family) return false;
  if (rule.dateFrom || rule.dateTo) {
    if (!tx.date) return false;
    const iso = tx.date.toISOString().slice(0, 10);
    if (rule.dateFrom && iso < rule.dateFrom) return false;
    if (rule.dateTo && iso > rule.dateTo) return false;
  }
  return true;
}

/**
 * Determine le vehicule de chaque transaction. L'ordre de priorite reflete la
 * fiabilite decroissante des sources : correction manuelle, regle, immat lisible,
 * code flotte, puis carte.
 */
export function resolveTransactions(
  transactions: FuelTransaction[],
  vehicles: Map<string, Vehicle>,
  cardMap: Map<string, string>,
  rules: Rule[],
  overrides: Record<string, string>,
): ResolvedTransaction[] {
  const byFleetCode = new Map<string, string>();
  for (const v of vehicles.values()) {
    if (v.fleetCode && !byFleetCode.has(v.fleetCode)) byFleetCode.set(v.fleetCode, v.immat);
  }

  return transactions.map((tx) => {
    let assignedImmat = '';
    let source: AssignmentSource = 'aucune';

    const override = overrides[tx.id];
    if (override === EXCLUDED_IMMAT) {
      // Exclusion explicite : la ligne ne compte pour aucun vehicule.
      assignedImmat = '';
      source = 'manuelle';
    } else if (override) {
      assignedImmat = override;
      source = 'manuelle';
    } else {
      const rule = rules.find((r) => ruleMatches(r, tx));
      if (rule) {
        assignedImmat = rule.targetImmat;
        source = 'regle';
      } else if (tx.declaredImmat && vehicles.has(tx.declaredImmat)) {
        assignedImmat = tx.declaredImmat;
        source = 'declaree';
      } else if (tx.fleetCode && byFleetCode.has(tx.fleetCode)) {
        assignedImmat = byFleetCode.get(tx.fleetCode)!;
        source = 'code-flotte';
      } else if (tx.card && cardMap.has(tx.card)) {
        assignedImmat = cardMap.get(tx.card)!;
        source = 'carte';
      }
    }

    return {
      ...tx,
      assignedImmat,
      assignmentSource: source,
      reassigned: Boolean(assignedImmat) && assignedImmat !== tx.declaredImmat,
    };
  });
}

/** Position kilometrique attendue d'un vehicule a une date donnee (interpolation lineaire). */
export function expectedOdometer(km: KmRecord, at: Date): number | null {
  if (km.kmStart == null || km.kmEnd == null) return null;
  if (!km.start || !km.end) return (km.kmStart + km.kmEnd) / 2;
  const span = km.end.getTime() - km.start.getTime();
  if (span <= 0) return km.kmStart;
  const ratio = Math.min(1, Math.max(0, (at.getTime() - km.start.getTime()) / span));
  return km.kmStart + (km.kmEnd - km.kmStart) * ratio;
}

/**
 * Note la compatibilite d'un releve de compteur avec un vehicule, entre 0 et 1.
 * Un releve dans la plage du vehicule et proche de la position attendue vaut 1.
 */
export function odometerScore(km: KmRecord, odometer: number, at: Date | null, tolerance: number): number {
  if (km.kmStart == null || km.kmEnd == null || odometer <= 0) return 0;
  const low = km.kmStart - tolerance;
  const high = km.kmEnd + tolerance;
  if (odometer < low || odometer > high) return 0;

  const expected = at ? expectedOdometer(km, at) : (km.kmStart + km.kmEnd) / 2;
  if (expected == null) return 0.5;
  const span = Math.max(1000, Math.abs(km.kmEnd - km.kmStart));
  const deviation = Math.abs(odometer - expected) / span;
  return Math.max(0.2, 1 - Math.min(1, deviation));
}

export interface Candidate {
  immat: string;
  score: number;
  reason: string;
}

/**
 * Propose les vehicules les plus probables pour une transaction, en croisant le
 * compteur saisi a la pompe avec les plages kilometriques connues.
 */
export function suggestVehicles(
  tx: FuelTransaction,
  kmByImmat: Map<string, KmRecord>,
  vehicles: Map<string, Vehicle>,
  settings: Settings,
  litresByImmat: Map<string, number>,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [immat, km] of kmByImmat) {
    const vehicle = vehicles.get(immat);
    if (!vehicle?.ticpe) continue;

    const reasons: string[] = [];
    let score = 0;

    if (tx.odometer != null && tx.odometer > 0) {
      const odo = odometerScore(km, tx.odometer, tx.date, settings.odometerTolerance);
      if (odo > 0) {
        score += odo * 0.7;
        reasons.push(`compteur ${Math.round(tx.odometer).toLocaleString('fr-FR')} km cohérent avec sa plage`);
      }
    }

    if (tx.fleetCode && vehicle.fleetCode && tx.fleetCode === vehicle.fleetCode) {
      score += 0.5;
      reasons.push(`code flotte ${tx.fleetCode}`);
    }

    // Un camion qui a roule sans jamais prendre de carburant est le suspect naturel.
    const litres = litresByImmat.get(immat) ?? 0;
    if ((km.km ?? 0) > 0 && litres === 0) {
      score += 0.25;
      reasons.push('aucun plein rattaché alors que le camion a roulé');
    }

    if (tx.date && km.start && km.end) {
      const t = tx.date.getTime();
      if (t < km.start.getTime() - 86400000 || t > km.end.getTime() + 86400000) {
        // Le plein tombe hors de la periode d'activite du vehicule.
        score -= 0.4;
      }
    }

    if (score > 0.15) candidates.push({ immat, score: Math.min(1, score), reason: reasons.join(', ') });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Somme des volumes par vehicule pour une famille de produit donnee. */
export function sumByVehicle(resolved: ResolvedTransaction[], family: ProductFamily): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of resolved) {
    if (t.family !== family || !t.assignedImmat) continue;
    out.set(t.assignedImmat, (out.get(t.assignedImmat) ?? 0) + t.volume);
  }
  return out;
}

/** Assemble le referentiel, la cartographie des cartes et les affectations. */
export function runEngine({ kmRecords, transactions, state }: EngineInput): EngineOutput {
  const vehicles = buildRegistry(kmRecords, transactions, state.vehicles);
  const learnedCards = learnCardMap(transactions, vehicles);

  // Les corrections utilisateur sur les cartes ecrasent l'apprentissage automatique.
  const cardMap = new Map(learnedCards);
  for (const [card, immat] of Object.entries(state.cardMap)) {
    if (immat) cardMap.set(card, immat);
    else cardMap.delete(card);
  }

  const kmByImmat = new Map(kmRecords.map((r) => [r.immat, r]));
  const resolved = resolveTransactions(transactions, vehicles, cardMap, state.rules, state.overrides);

  const dates = [
    ...kmRecords.flatMap((r) => [r.start, r.end]),
    ...transactions.map((t) => t.date),
  ].filter((d): d is Date => d != null);

  return {
    vehicles,
    kmByImmat,
    resolved,
    cardMap,
    learnedCards,
    periodStart: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    periodEnd: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
  };
}

/** Construit le recapitulatif final, une ligne par vehicule du perimetre TICPE. */
export function computeRecap(output: EngineOutput, state: PersistedState): RecapRow[] {
  const gazole = sumByVehicle(output.resolved, 'gazole');
  const adblue = sumByVehicle(output.resolved, 'adblue');

  const txCount = new Map<string, number>();
  for (const t of output.resolved) {
    if (t.family === 'gazole' && t.assignedImmat) {
      txCount.set(t.assignedImmat, (txCount.get(t.assignedImmat) ?? 0) + 1);
    }
  }

  // Toute immat ayant des km ou du gazole merite une ligne.
  const immats = new Set<string>([...output.kmByImmat.keys()]);
  for (const [immat] of gazole) {
    if (output.vehicles.get(immat)?.ticpe) immats.add(immat);
  }

  const rows: RecapRow[] = [];
  for (const immat of immats) {
    const vehicle = output.vehicles.get(immat);
    const km = output.kmByImmat.get(immat);
    const edit = state.recapEdits[immat];

    const baseKm = km?.km ?? null;
    const finalKm = edit?.km ?? baseKm;
    const baseLitres = gazole.get(immat) ?? 0;
    const finalLitres = edit?.litres ?? baseLitres;

    const conso = finalKm && finalKm > 0 && finalLitres > 0 ? (finalLitres / finalKm) * 100 : null;

    rows.push({
      immat,
      label: vehicle?.label || formatImmat(immat),
      region: vehicle?.region ?? '',
      category: vehicle?.category ?? '',
      fleetCode: vehicle?.fleetCode || km?.fleetCode || '',
      kmStart: km?.kmStart ?? null,
      kmEnd: km?.kmEnd ?? null,
      km: finalKm,
      litres: finalLitres,
      adblue: adblue.get(immat) ?? 0,
      conso,
      txCount: txCount.get(immat) ?? 0,
      edited: Boolean(edit && (edit.km != null || edit.litres != null)),
      history: state.history
        .slice()
        .sort((a, b) => b.quarter.localeCompare(a.quarter))
        .slice(0, 8)
        .map((snap) => ({
          quarter: snap.quarter,
          conso: snap.rows.find((r) => r.immat === immat)?.conso ?? null,
        })),
      flags: [],
    });
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
