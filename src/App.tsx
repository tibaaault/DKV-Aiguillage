import { useState } from 'react';
import { useAppState } from './state';
import { ImportPanel } from './components/ImportPanel';
import { AnomalyPanel } from './components/AnomalyPanel';
import { TransactionsPanel } from './components/TransactionsPanel';
import { RecapPanel } from './components/RecapPanel';
import { RegistryPanel } from './components/RegistryPanel';
import { Empty, num } from './components/common';

type Tab = 'import' | 'controle' | 'transactions' | 'recap' | 'referentiel';

const TABS: Array<{ id: Tab; num: string; label: string; needsData: boolean }> = [
  { id: 'import', num: '1', label: 'Importer', needsData: false },
  { id: 'controle', num: '2', label: 'Contrôler', needsData: true },
  { id: 'transactions', num: '3', label: 'Corriger', needsData: true },
  { id: 'recap', num: '4', label: 'Récapitulatif', needsData: true },
  { id: 'referentiel', num: '⚙', label: 'Référentiel', needsData: false },
];

export default function App() {
  const app = useAppState();
  const [tab, setTab] = useState<Tab>('import');
  const [highlighted, setHighlighted] = useState<string[]>([]);

  const critiques = app.anomalies.filter((a) => a.severity === 'critique').length;
  const totalKm = app.recap.reduce((s, r) => s + (r.km ?? 0), 0);
  const totalL = app.recap.reduce((s, r) => s + r.litres, 0);

  const goToTransactions = (ids: string[]) => {
    setHighlighted(ids);
    setTab('transactions');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand">
            <h1>🚚 DKV Aiguillage</h1>
            <span className="period">{app.hasData ? app.periodLabel : 'aucun fichier chargé'}</span>
          </div>

          {app.hasData && (
            <div className="kpis">
              <div className="kpi">
                <b>{app.recap.length}</b>
                <span>camions</span>
              </div>
              <div className="kpi">
                <b>{num(totalKm)}</b>
                <span>km</span>
              </div>
              <div className="kpi">
                <b>{num(totalL)}</b>
                <span>litres</span>
              </div>
              <div className="kpi">
                <b>{totalKm > 0 ? num((totalL / totalKm) * 100, 2) : '—'}</b>
                <span>L/100 km</span>
              </div>
              <div className={`kpi${critiques ? ' alert' : ''}`}>
                <b>{critiques}</b>
                <span>à traiter</span>
              </div>
            </div>
          )}
        </div>

        <nav className="steps" aria-label="Étapes">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="step"
              aria-current={tab === t.id}
              disabled={t.needsData && !app.hasData}
              onClick={() => {
                setTab(t.id);
                if (t.id !== 'transactions') setHighlighted([]);
              }}
            >
              <span className="num">{t.num}</span>
              {t.label}
              {t.id === 'controle' && critiques > 0 && <span className="badge">{critiques}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'import' && <ImportPanel app={app} onNext={() => setTab('controle')} />}

        {tab === 'controle' &&
          (app.hasData ? (
            <AnomalyPanel app={app} onGoToTransactions={goToTransactions} />
          ) : (
            <Empty icon="📥" title="Importez d'abord vos fichiers" />
          ))}

        {tab === 'transactions' && (
          <TransactionsPanel app={app} highlighted={highlighted} onClearHighlight={() => setHighlighted([])} />
        )}

        {tab === 'recap' && <RecapPanel app={app} />}

        {tab === 'referentiel' && <RegistryPanel app={app} />}
      </main>

      {app.busy && <div className="toast">Analyse des fichiers…</div>}
      {app.toast && <div className={`toast${app.toast.kind === 'error' ? ' error' : ''}`}>{app.toast.text}</div>}
    </div>
  );
}
