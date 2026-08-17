import { Card, DropZone, num } from './common';
import type { AppState } from '../state';
import { formatDate, quarterKey } from '../lib/normalize';

/** Etape 1 : chargement du releve kilometrique et des exports DKV. */
export function ImportPanel({ app, onNext }: { app: AppState; onNext: () => void }) {
  const { kmFile, dkvFiles, transactions, duplicates } = app;

  // Le trimestre de reference vient du releve km ; on compare chaque export a celui-ci.
  const refQuarter = kmFile?.periodStart ? quarterKey(kmFile.periodStart) : null;

  return (
    <>
      <p className="intro">
        Déposez le relevé kilométrique du trimestre puis les exports DKV du mois. Tout est analysé
        directement dans votre navigateur : <strong>aucun fichier n'est envoyé sur Internet</strong>.
      </p>

      <div className="grid-2">
        <Card
          title="1 · Relevé kilométrique TICPE"
          hint="Le fichier texte qui liste les camions et leurs compteurs. Il définit le périmètre et la période."
        >
          <DropZone
            icon="🚚"
            label={kmFile ? 'Remplacer le relevé kilométrique' : 'Déposer le relevé kilométrique'}
            hint="Fichier .txt ou .csv — un seul fichier"
            accept=".txt,.csv,text/plain"
            onFiles={(files) => app.loadKm(files[0])}
          />

          {kmFile && (
            <ul className="filelist">
              <li>
                <span aria-hidden="true">📄</span>
                <span className="name">{kmFile.fileName}</span>
                <span className="meta">
                  {kmFile.records.length} véhicule{kmFile.records.length > 1 ? 's' : ''}
                  {kmFile.periodStart && kmFile.periodEnd
                    ? ` · ${formatDate(kmFile.periodStart)} → ${formatDate(kmFile.periodEnd)}`
                    : ''}
                </span>
              </li>
            </ul>
          )}

          {kmFile && kmFile.warnings.length > 0 && (
            <div className="banner warn" style={{ marginTop: 14 }}>
              <strong>À vérifier dans ce relevé :</strong>
              <ul>
                {kmFile.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {kmFile.warnings.length > 8 && <li>… et {kmFile.warnings.length - 8} autre(s).</li>}
              </ul>
            </div>
          )}
        </Card>

        <Card
          title="2 · Exports carburant DKV"
          hint="Un fichier par mois, ou un classeur à plusieurs onglets. Les colonnes sont reconnues automatiquement."
          actions={
            dkvFiles.length > 0 ? (
              <button className="btn sm ghost danger" onClick={() => dkvFiles.forEach((f) => app.removeDkv(f.key))}>
                Tout retirer
              </button>
            ) : undefined
          }
        >
          <DropZone
            icon="⛽"
            label="Déposer un ou plusieurs exports DKV"
            hint="Fichiers .xlsx, .xls ou .csv — sélection multiple possible"
            accept=".xlsx,.xls,.csv"
            multiple
            onFiles={app.loadDkv}
          />

          {dkvFiles.length > 0 && (
            <ul className="filelist">
              {dkvFiles.map((f) => {
                const quarter = f.periodStart ? quarterKey(f.periodStart) : null;
                const mismatch = refQuarter && quarter && quarter !== refQuarter;
                return (
                  <li key={f.key}>
                    <span aria-hidden="true">{mismatch ? '⚠️' : '📊'}</span>
                    <span className="name">{f.fileName}</span>
                    <span className={`chip ${mismatch ? 'bad' : 'neutral'}`}>
                      {f.periodStart && f.periodEnd
                        ? `${formatDate(f.periodStart)} → ${formatDate(f.periodEnd)}`
                        : 'période inconnue'}
                    </span>
                    <span className="meta">{f.transactions.length} lignes</span>
                    <button
                      className="btn sm ghost"
                      onClick={() => app.removeDkv(f.key)}
                      aria-label={`Retirer ${f.fileName}`}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {dkvFiles.some((f) => f.warnings.length > 0) && (
            <div className="banner warn" style={{ marginTop: 14 }}>
              <strong>Remarques sur les exports :</strong>
              <ul>
                {dkvFiles.flatMap((f) => f.warnings.map((w) => `${f.fileName} — ${w}`)).slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {refQuarter && dkvFiles.some((f) => f.periodStart && quarterKey(f.periodStart) !== refQuarter) && (
        <div className="banner bad">
          <strong>Attention : un export ne couvre pas le bon trimestre.</strong> Le relevé kilométrique
          porte sur {refQuarter}, mais au moins un fichier DKV contient des transactions d'une autre
          période. Vérifiez que vous avez téléchargé le bon export avant d'aller plus loin — les totaux
          seraient faux.
        </div>
      )}

      {app.hasData && (
        <Card title="Ce qui a été lu" hint="Vérifiez ces chiffres avant de passer au contrôle.">
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <Stat label="Camions au relevé km" value={num(kmFile?.records.length ?? 0)} />
            <Stat label="Transactions retenues" value={num(transactions.length)} />
            <Stat
              label="Dont gazole"
              value={num(transactions.filter((t) => t.family === 'gazole').length)}
            />
            <Stat
              label="Litres de gazole"
              value={num(
                transactions.filter((t) => t.family === 'gazole').reduce((s, t) => s + t.volume, 0),
                2,
              )}
            />
            <Stat label="Doublons écartés" value={num(duplicates.length)} />
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={onNext} disabled={!kmFile?.records.length}>
              Passer au contrôle →
            </button>
            {!kmFile?.records.length && (
              <span style={{ alignSelf: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
                Le relevé kilométrique est nécessaire pour calculer les consommations.
              </span>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  );
}
