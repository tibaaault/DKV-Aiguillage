import { useMemo, useState } from 'react';
import { Card, Empty, num } from './common';
import type { AppState } from '../state';
import { EXCLUDED_IMMAT, FAMILY_LABEL, type ProductFamily, type Rule } from '../lib/model';
import { formatDateTime, formatImmat } from '../lib/normalize';
import { suggestVehicles } from '../lib/engine';

type Focus = 'toutes' | 'gazole' | 'non-rattachees' | 'reaffectees' | 'suspectes';

/** Etape 3 : tableau des transactions, reaffectation ligne par ligne ou en masse. */
export function TransactionsPanel({
  app,
  highlighted,
  onClearHighlight,
}: {
  app: AppState;
  highlighted: string[];
  onClearHighlight: () => void;
}) {
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<Focus>('gazole');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showRuleForm, setShowRuleForm] = useState(false);

  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  const vehicleOptions = useMemo(
    () =>
      [...app.engine.vehicles.values()]
        .sort((a, b) => Number(b.ticpe) - Number(a.ticpe) || a.label.localeCompare(b.label, 'fr')),
    [app.engine.vehicles],
  );

  const litresByImmat = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of app.engine.resolved) {
      if (t.family === 'gazole' && t.assignedImmat) {
        m.set(t.assignedImmat, (m.get(t.assignedImmat) ?? 0) + t.volume);
      }
    }
    return m;
  }, [app.engine.resolved]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return app.engine.resolved
      .filter((t) => {
        if (highlightSet.size && !highlightSet.has(t.id)) return false;
        if (focus === 'gazole' && t.family !== 'gazole') return false;
        if (focus === 'non-rattachees' && t.assignedImmat) return false;
        if (focus === 'reaffectees' && !t.reassigned) return false;
        if (focus === 'suspectes') {
          const own = t.assignedImmat ? app.engine.kmByImmat.get(t.assignedImmat) : null;
          const inRange =
            own?.kmStart != null &&
            own.kmEnd != null &&
            t.odometer != null &&
            t.odometer >= own.kmStart - app.persisted.settings.odometerTolerance &&
            t.odometer <= own.kmEnd + app.persisted.settings.odometerTolerance;
          const suspicious = t.family === 'gazole' && (!t.assignedImmat || (t.odometer != null && t.odometer > 0 && !inRange));
          if (!suspicious) return false;
        }
        if (!needle) return true;
        return (
          t.rawImmat.toLowerCase().includes(needle) ||
          t.assignedImmat.toLowerCase().includes(needle) ||
          t.card.toLowerCase().includes(needle) ||
          t.city.toLowerCase().includes(needle) ||
          t.station.toLowerCase().includes(needle) ||
          t.sourceFile.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  }, [app.engine, app.persisted.settings.odometerTolerance, search, focus, highlightSet]);

  const totalLitres = rows.filter((r) => r.family === 'gazole').reduce((s, r) => s + r.volume, 0);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <p className="intro">
        Chaque ligne est un passage à la pompe. La colonne <strong>Affecté à</strong> décide à quel
        camion les litres sont comptés — modifiez-la si le chauffeur s'est trompé de carte ou de
        plaque. Vos choix sont mémorisés.
      </p>

      {highlightSet.size > 0 && (
        <div className="banner info">
          Affichage limité à {highlightSet.size} ligne(s) issues d'une anomalie.{' '}
          <button className="btn sm ghost" onClick={onClearHighlight}>
            Afficher toutes les transactions
          </button>
        </div>
      )}

      <Card title="Transactions" flush>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Rechercher une immat, une carte, une ville…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={focus} onChange={(e) => setFocus(e.target.value as Focus)}>
            <option value="gazole">Gazole uniquement</option>
            <option value="toutes">Tous les produits</option>
            <option value="non-rattachees">Non rattachées</option>
            <option value="reaffectees">Réaffectées</option>
            <option value="suspectes">Compteur incohérent</option>
          </select>

          <span className="chip neutral">
            {rows.length} ligne(s) · {num(totalLitres, 2)} L de gazole
          </span>

          <span className="spacer" />

          {selected.size > 0 && (
            <>
              <span className="chip brand">{selected.size} sélectionnée(s)</span>
              <select
                className="assign"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  // « __auto__ » supprime la correction : la ligne repasse en affectation automatique.
                  const target = e.target.value === '__auto__' ? '' : e.target.value;
                  app.setOverride([...selected], target);
                  app.notify(`${selected.size} ligne(s) mise(s) à jour.`);
                  setSelected(new Set());
                }}
              >
                <option value="">Réaffecter la sélection à…</option>
                <option value={EXCLUDED_IMMAT}>⊘ Exclure du calcul</option>
                <option value="__auto__">↺ Revenir à l'affectation automatique</option>
                {vehicleOptions.map((v) => (
                  <option key={v.immat} value={v.immat}>
                    {v.label}
                    {v.ticpe ? '' : ' (hors TICPE)'}
                  </option>
                ))}
              </select>
              <button className="btn sm" onClick={() => setShowRuleForm(true)}>
                Créer une règle…
              </button>
              <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
                Désélectionner
              </button>
            </>
          )}
        </div>

        {showRuleForm && (
          <RuleForm
            app={app}
            sampleIds={[...selected]}
            onClose={() => setShowRuleForm(false)}
            vehicleOptions={vehicleOptions}
          />
        )}

        {rows.length === 0 ? (
          <Empty icon="🔍" title="Aucune transaction ne correspond au filtre" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                      }
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th>Date</th>
                  <th>Immat. saisie</th>
                  <th>Affecté à</th>
                  <th>Origine</th>
                  <th>Produit</th>
                  <th className="num">Volume</th>
                  <th className="num">Compteur</th>
                  <th>Contrôle compteur</th>
                  <th>Carte</th>
                  <th>Station</th>
                  <th>Fichier</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 800).map((t) => {
                  const own = t.assignedImmat ? app.engine.kmByImmat.get(t.assignedImmat) : null;
                  const tol = app.persisted.settings.odometerTolerance;
                  const inRange =
                    own?.kmStart != null &&
                    own.kmEnd != null &&
                    t.odometer != null &&
                    t.odometer >= own.kmStart - tol &&
                    t.odometer <= own.kmEnd + tol;

                  const candidates =
                    !inRange && t.odometer != null && t.odometer > 0 && t.family === 'gazole'
                      ? suggestVehicles(t, app.engine.kmByImmat, app.engine.vehicles, app.persisted.settings, litresByImmat)
                          .filter((c) => c.immat !== t.assignedImmat)
                          .slice(0, 1)
                      : [];

                  return (
                    <tr key={t.id} className={selected.has(t.id) ? 'selected' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          aria-label="Sélectionner la ligne"
                        />
                      </td>
                      <td>{formatDateTime(t.date)}</td>
                      <td className="mono">{t.rawImmat || <span style={{ color: 'var(--bad)' }}>vide</span>}</td>
                      <td>
                        <select
                          className={`assign${t.reassigned ? ' changed' : ''}${t.assignedImmat ? '' : ' none'}`}
                          value={
                            app.persisted.overrides[t.id] === EXCLUDED_IMMAT ? EXCLUDED_IMMAT : t.assignedImmat
                          }
                          onChange={(e) =>
                            app.setOverride([t.id], e.target.value === '__auto__' ? '' : e.target.value)
                          }
                        >
                          {!t.assignedImmat && app.persisted.overrides[t.id] !== EXCLUDED_IMMAT && (
                            <option value="">— non rattaché —</option>
                          )}
                          <option value={EXCLUDED_IMMAT}>⊘ exclu du calcul</option>
                          {vehicleOptions.map((v) => (
                            <option key={v.immat} value={v.immat}>
                              {v.label}
                              {v.ticpe ? '' : ' (hors TICPE)'}
                            </option>
                          ))}
                          {app.persisted.overrides[t.id] != null && (
                            <option value="__auto__">↺ affectation automatique</option>
                          )}
                        </select>
                      </td>
                      <td>
                        <span className={`chip ${t.assignmentSource === 'manuelle' ? 'ok' : 'neutral'}`}>
                          {app.persisted.overrides[t.id] === EXCLUDED_IMMAT ? 'exclue' : t.assignmentSource}
                        </span>
                      </td>
                      <td>{FAMILY_LABEL[t.family]}</td>
                      <td className="num">{t.volume.toFixed(2)}</td>
                      <td className="num">{t.odometer != null && t.odometer > 0 ? t.odometer.toLocaleString('fr-FR') : '—'}</td>
                      <td>
                        {t.odometer == null || t.odometer <= 0 ? (
                          <span className="chip neutral">non saisi</span>
                        ) : inRange ? (
                          <span className="chip ok">cohérent</span>
                        ) : candidates.length ? (
                          <button
                            className="btn sm"
                            title={candidates[0].reason}
                            onClick={() => app.setOverride([t.id], candidates[0].immat)}
                          >
                            → {formatImmat(candidates[0].immat)} ({Math.round(candidates[0].score * 100)} %)
                          </button>
                        ) : (
                          <span className="chip warn">hors plage</span>
                        )}
                      </td>
                      <td className="mono">{t.card || '—'}</td>
                      <td>{[t.station, t.city].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{t.sourceFile}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 800 && (
              <p style={{ padding: 12, margin: 0, color: 'var(--ink-2)' }}>
                Affichage limité aux 800 premières lignes. Affinez la recherche pour voir les suivantes.
              </p>
            )}
          </div>
        )}
      </Card>

      <RuleList app={app} />
    </>
  );
}

/** Formulaire de creation d'une regle de correction en masse, pre-remplie depuis la selection. */
function RuleForm({
  app,
  sampleIds,
  onClose,
  vehicleOptions,
}: {
  app: AppState;
  sampleIds: string[];
  onClose: () => void;
  vehicleOptions: Array<{ immat: string; label: string; ticpe: boolean }>;
}) {
  const sample = app.engine.resolved.find((t) => sampleIds.includes(t.id));
  const dates = app.engine.resolved
    .filter((t) => sampleIds.includes(t.id))
    .map((t) => t.date)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  const [draft, setDraft] = useState<Omit<Rule, 'id'>>({
    enabled: true,
    label: '',
    matchField: sample?.card ? 'card' : 'declaredImmat',
    matchValue: sample?.card || sample?.declaredImmat || '',
    dateFrom: dates.length ? dates[0].toISOString().slice(0, 10) : '',
    dateTo: dates.length ? dates[dates.length - 1].toISOString().slice(0, 10) : '',
    family: 'gazole' as ProductFamily,
    targetImmat: '',
  });

  const matchCount = app.engine.resolved.filter((t) => {
    const value =
      draft.matchField === 'card' ? t.card : draft.matchField === 'fleetCode' ? t.fleetCode : t.declaredImmat;
    if (!value || value.toUpperCase() !== draft.matchValue.toUpperCase()) return false;
    if (draft.family && t.family !== draft.family) return false;
    if (draft.dateFrom || draft.dateTo) {
      if (!t.date) return false;
      const iso = t.date.toISOString().slice(0, 10);
      if (draft.dateFrom && iso < draft.dateFrom) return false;
      if (draft.dateTo && iso > draft.dateTo) return false;
    }
    return true;
  }).length;

  return (
    <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', background: 'var(--brand-soft)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Nouvelle règle de correction</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-2)' }}>
        Une règle s'applique automatiquement à chaque nouvel import, tant qu'elle est active. Idéale
        pour un échange de carte qui dure plusieurs semaines.
      </p>

      <div className="form-row">
        <div className="field">
          <label htmlFor="rule-field">Critère</label>
          <select
            id="rule-field"
            value={draft.matchField}
            onChange={(e) => setDraft({ ...draft, matchField: e.target.value as Rule['matchField'] })}
          >
            <option value="card">Numéro de carte</option>
            <option value="declaredImmat">Immatriculation saisie</option>
            <option value="fleetCode">Code flotte</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-value">Valeur</label>
          <input
            id="rule-value"
            value={draft.matchValue}
            onChange={(e) => setDraft({ ...draft, matchValue: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="rule-from">À partir du</label>
          <input
            id="rule-from"
            type="date"
            value={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="rule-to">Jusqu'au</label>
          <input
            id="rule-to"
            type="date"
            value={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="rule-family">Produit</label>
          <select
            id="rule-family"
            value={draft.family}
            onChange={(e) => setDraft({ ...draft, family: e.target.value as ProductFamily | '' })}
          >
            <option value="">Tous</option>
            {Object.entries(FAMILY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-target">Affecter à</label>
          <select
            id="rule-target"
            value={draft.targetImmat}
            onChange={(e) => setDraft({ ...draft, targetImmat: e.target.value })}
          >
            <option value="">— choisir un camion —</option>
            {vehicleOptions.map((v) => (
              <option key={v.immat} value={v.immat}>
                {v.label}
                {v.ticpe ? '' : ' (hors TICPE)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`chip ${matchCount ? 'brand' : 'warn'}`}>
          {matchCount} transaction(s) correspondront à cette règle
        </span>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!draft.matchValue || !draft.targetImmat}
          onClick={() => {
            app.addRule({
              ...draft,
              id: `rule-${Date.now()}`,
              label:
                draft.label ||
                `${draft.matchField === 'card' ? 'Carte' : draft.matchField === 'fleetCode' ? 'Code flotte' : 'Immat'} ${draft.matchValue} → ${formatImmat(draft.targetImmat)}`,
            });
            app.notify('Règle créée et appliquée.');
            onClose();
          }}
        >
          Créer la règle
        </button>
        <button className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function RuleList({ app }: { app: AppState }) {
  const { rules } = app.persisted;
  if (!rules.length) return null;

  return (
    <Card title="Règles de correction actives" hint="Réappliquées automatiquement à chaque import.">
      <div className="table-wrap" style={{ maxHeight: 300 }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }}>Active</th>
              <th>Règle</th>
              <th>Période</th>
              <th>Produit</th>
              <th className="num">Lignes touchées</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const touched = app.engine.resolved.filter(
                (t) => t.assignmentSource === 'regle' && t.assignedImmat === r.targetImmat,
              ).length;
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => app.updateRule(r.id, { enabled: e.target.checked })}
                      aria-label={`Activer ${r.label}`}
                    />
                  </td>
                  <td>{r.label}</td>
                  <td>
                    {r.dateFrom || r.dateTo ? `${r.dateFrom || '…'} → ${r.dateTo || '…'}` : 'toute la période'}
                  </td>
                  <td>{r.family ? FAMILY_LABEL[r.family] : 'tous'}</td>
                  <td className="num">{touched}</td>
                  <td>
                    <button className="btn sm ghost danger" onClick={() => app.removeRule(r.id)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
