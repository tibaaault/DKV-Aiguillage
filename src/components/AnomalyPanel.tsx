import { useState } from 'react';
import { Card, Empty } from './common';
import type { AppState } from '../state';
import type { Anomaly, AnomalySeverity } from '../lib/model';
import { formatDateTime, formatImmat } from '../lib/normalize';

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  critique: 'À traiter',
  avertissement: 'À vérifier',
  info: 'Pour information',
};

const SEVERITY_ICON: Record<AnomalySeverity, string> = {
  critique: '⛔',
  avertissement: '⚠️',
  info: 'ℹ️',
};

/** Etape 2 : liste des controles, avec correction en un clic quand elle est fiable. */
export function AnomalyPanel({ app, onGoToTransactions }: { app: AppState; onGoToTransactions: (ids: string[]) => void }) {
  const [filter, setFilter] = useState<AnomalySeverity | 'toutes'>('toutes');
  const shown = filter === 'toutes' ? app.anomalies : app.anomalies.filter((a) => a.severity === filter);

  const counts = {
    critique: app.anomalies.filter((a) => a.severity === 'critique').length,
    avertissement: app.anomalies.filter((a) => a.severity === 'avertissement').length,
    info: app.anomalies.filter((a) => a.severity === 'info').length,
  };

  return (
    <>
      <p className="intro">
        Chaque point ci-dessous a été détecté en croisant les kilomètres, les litres et les compteurs
        saisis à la pompe. Les corrections proposées sont applicables en un clic, et restent
        modifiables ensuite dans l'onglet Transactions.
      </p>

      <Card
        title="Contrôles"
        hint={`${app.anomalies.length} point(s) relevé(s) sur ${app.transactions.length} transactions.`}
        actions={
          <div className="toolbar" style={{ padding: 0, border: 0, background: 'none' }}>
            {(['toutes', 'critique', 'avertissement', 'info'] as const).map((f) => (
              <button
                key={f}
                className={`btn sm${filter === f ? ' primary' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'toutes' ? `Tout (${app.anomalies.length})` : `${SEVERITY_LABEL[f]} (${counts[f]})`}
              </button>
            ))}
          </div>
        }
      >
        {app.anomalies.length === 0 ? (
          <Empty icon="✅" title="Aucune anomalie détectée">
            Les kilomètres et les litres sont cohérents pour tous les camions du périmètre. Vous pouvez
            passer directement au récapitulatif.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty icon="🔍" title="Rien dans cette catégorie" />
        ) : (
          shown.map((a) => (
            <AnomalyCard key={a.id} anomaly={a} app={app} onInspect={() => onGoToTransactions(a.transactionIds ?? [])} />
          ))
        )}
      </Card>
    </>
  );
}

function AnomalyCard({
  anomaly,
  app,
  onInspect,
}: {
  anomaly: Anomaly;
  app: AppState;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const suggestion = anomaly.suggestion;
  const affected = anomaly.transactionIds ?? [];
  const preview = app.engine.resolved.filter((t) => affected.includes(t.id)).slice(0, 6);

  return (
    <article className={`anomaly ${anomaly.severity}`}>
      <h3>
        <span aria-hidden="true">{SEVERITY_ICON[anomaly.severity]}</span>
        {anomaly.title}
        {anomaly.immat && <span className="chip neutral">{formatImmat(anomaly.immat)}</span>}
      </h3>
      <p>{anomaly.detail}</p>

      <div className="actions">
        {suggestion && (
          <button
            className="btn primary sm"
            onClick={() => app.applySuggestion(anomaly)}
            title={`Confiance estimée : ${Math.round(suggestion.confidence * 100)} %`}
          >
            {suggestion.kind === 'reassign' ? '✔ ' : '✖ '}
            {suggestion.reason}
          </button>
        )}
        {suggestion && (
          <span className="chip neutral">confiance {Math.round(suggestion.confidence * 100)} %</span>
        )}
        {affected.length > 0 && (
          <>
            <button className="btn sm" onClick={onInspect}>
              Voir les {affected.length} ligne(s)
            </button>
            <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}>
              {open ? 'Masquer l’aperçu' : 'Aperçu rapide'}
            </button>
          </>
        )}
      </div>

      {open && preview.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 11, maxHeight: 220 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Immat. déclarée</th>
                <th>Affecté à</th>
                <th className="num">Litres</th>
                <th className="num">Compteur saisi</th>
                <th>Station</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.date)}</td>
                  <td className="mono">{t.rawImmat || '—'}</td>
                  <td>{t.assignedImmat ? formatImmat(t.assignedImmat) : '— non rattaché —'}</td>
                  <td className="num">{t.volume.toFixed(2)}</td>
                  <td className="num">{t.odometer != null ? t.odometer.toLocaleString('fr-FR') : '—'}</td>
                  <td>{[t.station, t.city].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {affected.length > preview.length && (
            <p style={{ padding: '8px 10px', margin: 0, color: 'var(--ink-2)', fontSize: 12 }}>
              … et {affected.length - preview.length} autre(s) ligne(s).
            </p>
          )}
        </div>
      )}
    </article>
  );
}
