import { useCallback, useEffect, useMemo, useState } from 'react';
import { detectAnomalies } from './lib/anomalies';
import { computeRecap, runEngine } from './lib/engine';
import { EXCLUDED_IMMAT } from './lib/model';
import type {
  Anomaly,
  FuelTransaction,
  PersistedState,
  RecapEdit,
  Rule,
  Settings,
  Vehicle,
} from './lib/model';
import { dedupeTransactions, parseDkvWorkbook, type DkvParseResult } from './lib/parseDkv';
import { decodeText, parseKmFile, type KmParseResult } from './lib/parseKm';
import { emptyState, loadState, saveState } from './lib/storage';
import { formatDate, quarterKey } from './lib/normalize';

export interface LoadedDkv extends DkvParseResult {
  key: string;
}

export function useAppState() {
  const [persisted, setPersisted] = useState<PersistedState>(() => loadState());
  const [kmFile, setKmFile] = useState<KmParseResult | null>(null);
  const [dkvFiles, setDkvFiles] = useState<LoadedDkv[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  useEffect(() => saveState(persisted), [persisted]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => setToast({ text, kind }), []);

  // ------------------------------------------------------------- chargement
  const loadKm = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const text = decodeText(await file.arrayBuffer());
        const result = parseKmFile(text, file.name);
        setKmFile(result);
        notify(
          result.records.length
            ? `${result.records.length} véhicule(s) lus dans « ${file.name} ».`
            : `Aucun véhicule lu dans « ${file.name} ».`,
          result.records.length ? 'ok' : 'error',
        );
      } catch (err) {
        notify(`Lecture impossible : ${(err as Error).message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const loadDkv = useCallback(
    async (files: File[]) => {
      setBusy(true);
      try {
        const results: LoadedDkv[] = [];
        for (const file of files) {
          const parsed = parseDkvWorkbook(await file.arrayBuffer(), file.name);
          results.push({ ...parsed, key: `${file.name}:${file.size}:${file.lastModified}` });
        }
        setDkvFiles((prev) => {
          const map = new Map(prev.map((p) => [p.key, p]));
          for (const r of results) map.set(r.key, r);
          return [...map.values()].sort((a, b) => a.fileName.localeCompare(b.fileName, 'fr'));
        });
        const total = results.reduce((s, r) => s + r.transactions.length, 0);
        notify(`${total} transaction(s) importée(s) depuis ${results.length} fichier(s).`);
      } catch (err) {
        notify(`Import impossible : ${(err as Error).message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const removeDkv = useCallback((key: string) => {
    setDkvFiles((prev) => prev.filter((f) => f.key !== key));
  }, []);

  const clearFiles = useCallback(() => {
    setKmFile(null);
    setDkvFiles([]);
  }, []);

  // -------------------------------------------------------------- pipeline
  const allTransactions = useMemo<FuelTransaction[]>(
    () => dkvFiles.flatMap((f) => f.transactions),
    [dkvFiles],
  );

  const { unique: transactions, duplicates } = useMemo(
    () => dedupeTransactions(allTransactions),
    [allTransactions],
  );

  const engine = useMemo(
    () => runEngine({ kmRecords: kmFile?.records ?? [], transactions, state: persisted }),
    [kmFile, transactions, persisted],
  );

  const recap = useMemo(() => computeRecap(engine, persisted), [engine, persisted]);

  const anomalies = useMemo<Anomaly[]>(
    () =>
      detectAnomalies(
        engine,
        recap,
        persisted.settings,
        duplicates.map((d) => d.id),
      ),
    [engine, recap, persisted, duplicates],
  );

  const periodLabel = useMemo(() => {
    const start = kmFile?.periodStart ?? engine.periodStart;
    const end = kmFile?.periodEnd ?? engine.periodEnd;
    if (!start || !end) return 'période non déterminée';
    const q = quarterKey(start);
    const qEnd = quarterKey(end);
    const range = `${formatDate(start)} → ${formatDate(end)}`;
    return q === qEnd ? `${q} (${range})` : range;
  }, [kmFile, engine]);

  const hasData = Boolean(kmFile?.records.length || transactions.length);

  // --------------------------------------------------------------- actions
  const update = useCallback((fn: (draft: PersistedState) => PersistedState) => {
    setPersisted((prev) => fn(prev));
  }, []);

  const setOverride = useCallback(
    (transactionIds: string[], targetImmat: string) => {
      update((prev) => {
        const overrides = { ...prev.overrides };
        for (const id of transactionIds) {
          if (targetImmat) overrides[id] = targetImmat;
          else delete overrides[id];
        }
        return { ...prev, overrides };
      });
    },
    [update],
  );

  const clearOverrides = useCallback(
    (transactionIds: string[]) => {
      update((prev) => {
        const overrides = { ...prev.overrides };
        for (const id of transactionIds) delete overrides[id];
        return { ...prev, overrides };
      });
    },
    [update],
  );

  const addRule = useCallback(
    (rule: Rule) => update((prev) => ({ ...prev, rules: [...prev.rules, rule] })),
    [update],
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<Rule>) =>
      update((prev) => ({
        ...prev,
        rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      })),
    [update],
  );

  const removeRule = useCallback(
    (id: string) => update((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) })),
    [update],
  );

  const updateVehicle = useCallback(
    (immat: string, patch: Partial<Vehicle>) =>
      update((prev) => {
        const current = prev.vehicles[immat] ?? engine.vehicles.get(immat);
        if (!current) return prev;
        return { ...prev, vehicles: { ...prev.vehicles, [immat]: { ...current, ...patch, auto: false } } };
      }),
    [update, engine],
  );

  const setCardMapping = useCallback(
    (card: string, immat: string) =>
      update((prev) => ({ ...prev, cardMap: { ...prev.cardMap, [card]: immat } })),
    [update],
  );

  const setRecapEdit = useCallback(
    (immat: string, patch: RecapEdit | null) =>
      update((prev) => {
        const recapEdits = { ...prev.recapEdits };
        if (patch == null) delete recapEdits[immat];
        else recapEdits[immat] = { ...recapEdits[immat], ...patch };
        return { ...prev, recapEdits };
      }),
    [update],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) =>
      update((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),
    [update],
  );

  /** Fige le trimestre courant pour alimenter la colonne d'historique des exports suivants. */
  const saveQuarter = useCallback(() => {
    const start = kmFile?.periodStart ?? engine.periodStart;
    if (!start) {
      notify('Impossible de déterminer le trimestre à archiver.', 'error');
      return;
    }
    const quarter = quarterKey(start);
    update((prev) => ({
      ...prev,
      history: [
        ...prev.history.filter((h) => h.quarter !== quarter),
        {
          quarter,
          savedAt: new Date().toISOString(),
          rows: recap.map((r) => ({ immat: r.immat, km: r.km, litres: r.litres, conso: r.conso })),
        },
      ].sort((a, b) => a.quarter.localeCompare(b.quarter)),
    }));
    notify(`Trimestre ${quarter} archivé : il apparaîtra en historique aux trimestres suivants.`);
  }, [kmFile, engine, recap, update, notify]);

  const removeQuarter = useCallback(
    (quarter: string) =>
      update((prev) => ({ ...prev, history: prev.history.filter((h) => h.quarter !== quarter) })),
    [update],
  );

  const resetAll = useCallback(() => {
    setPersisted(emptyState());
    clearFiles();
    notify('Configuration et corrections effacées.');
  }, [clearFiles, notify]);

  const replaceState = useCallback(
    (next: PersistedState) => {
      setPersisted(next);
      notify('Configuration importée.');
    },
    [notify],
  );

  /** Applique la correction proposee par une anomalie. */
  const applySuggestion = useCallback(
    (anomaly: Anomaly) => {
      const s = anomaly.suggestion;
      if (!s) return;
      if (s.kind === 'reassign' && s.targetImmat) {
        setOverride(s.transactionIds, s.targetImmat);
        notify(`${s.transactionIds.length} ligne(s) réaffectée(s).`);
      } else if (s.kind === 'ignore') {
        setOverride(s.transactionIds, EXCLUDED_IMMAT);
        notify(`${s.transactionIds.length} ligne(s) exclue(s) du calcul.`);
      }
    },
    [setOverride, notify],
  );

  return {
    persisted,
    kmFile,
    dkvFiles,
    transactions,
    duplicates,
    engine,
    recap,
    anomalies,
    periodLabel,
    hasData,
    busy,
    toast,
    notify,
    loadKm,
    loadDkv,
    removeDkv,
    clearFiles,
    setOverride,
    clearOverrides,
    addRule,
    updateRule,
    removeRule,
    updateVehicle,
    setCardMapping,
    setRecapEdit,
    updateSettings,
    saveQuarter,
    removeQuarter,
    resetAll,
    replaceState,
    applySuggestion,
  };
}

export type AppState = ReturnType<typeof useAppState>;
