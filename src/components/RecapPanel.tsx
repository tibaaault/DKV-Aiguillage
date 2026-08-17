import { useState } from 'react';
import { Card, Empty, NumberCell, num } from './common';
import type { AppState } from '../state';
import { downloadBlob } from '../lib/storage';

/** Etape 4 : recapitulatif final, editable, et telechargement du classeur. */
export function RecapPanel({ app }: { app: AppState }) {
  const [exporting, setExporting] = useState(false);
  const { recap, persisted } = app;
  const { consoMin, consoMax } = persisted.settings;

  const totalKm = recap.reduce((s, r) => s + (r.km ?? 0), 0);
  const totalL = recap.reduce((s, r) => s + r.litres, 0);
  const totalConso = totalKm > 0 ? (totalL / totalKm) * 100 : null;
  const quarters = recap[0]?.history.map((h) => h.quarter) ?? [];

  const exportWorkbook = async () => {
    setExporting(true);
    try {
      // Charge le generateur Excel uniquement au premier telechargement.
      const { buildWorkbook } = await import('../lib/exportXlsx');
      const blob = await buildWorkbook({
        recap,
        transactions: app.engine.resolved,
        anomalies: app.anomalies,
        settings: persisted.settings,
        periodLabel: app.periodLabel,
        sourceFiles: [
          ...(app.kmFile ? [app.kmFile.fileName] : []),
          ...app.dkvFiles.map((f) => f.fileName),
        ],
      });
      const stamp = app.periodLabel.split(' ')[0].replace(/[^\w-]/g, '');
      downloadBlob(blob, `Consolidation TICPE ${stamp}.xlsx`);
      app.notify('Fichier Excel généré.');
    } catch (err) {
      app.notify(`Export impossible : ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!recap.length) {
    return (
      <Empty icon="📋" title="Rien à récapituler">
        Importez d'abord le relevé kilométrique pour voir apparaître les camions.
      </Empty>
    );
  }

  return (
    <>
      <p className="intro">
        Voici le tableau final. Les cases <strong>Km</strong> et <strong>Litres</strong> sont
        modifiables directement : une valeur saisie à la main remplace le calcul et apparaît en vert,
        dans l'application comme dans le fichier Excel.
      </p>

      <Card
        title="Récapitulatif par véhicule"
        hint={`${recap.length} véhicule(s) · ${app.periodLabel}`}
        actions={
          <>
            <button className="btn" onClick={app.saveQuarter} title="Conserve les consommations de ce trimestre pour les comparaisons futures">
              Archiver ce trimestre
            </button>
            <button className="btn primary" onClick={exportWorkbook} disabled={exporting}>
              {exporting ? 'Génération…' : '⬇ Télécharger le fichier Excel'}
            </button>
          </>
        }
        flush
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Région</th>
                <th>Immatriculation</th>
                <th>Code flotte</th>
                <th>Cat.</th>
                <th className="num">Km début</th>
                <th className="num">Km fin</th>
                <th className="num">Km parcourus</th>
                <th className="num">Litres gazole</th>
                <th className="num">Conso L/100</th>
                <th className="num">AdBlue</th>
                <th className="num">Pleins</th>
                {quarters.map((q) => (
                  <th key={q} className="num">
                    {q}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {recap.map((row) => {
                const edit = persisted.recapEdits[row.immat];
                const outOfRange = row.conso != null && (row.conso < consoMin || row.conso > consoMax);
                const noFuel = row.litres === 0 && (row.km ?? 0) > 0;
                return (
                  <tr key={row.immat}>
                    <td>{row.region || <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td className="mono">{row.fleetCode || '—'}</td>
                    <td>{row.category || '—'}</td>
                    <td className="num">{num(row.kmStart)}</td>
                    <td className="num">{num(row.kmEnd)}</td>
                    <td className="num">
                      <NumberCell
                        value={edit?.km ?? null}
                        placeholder={row.km}
                        edited={edit?.km != null}
                        onCommit={(v) => app.setRecapEdit(row.immat, { km: v ?? undefined })}
                      />
                    </td>
                    <td className="num">
                      <NumberCell
                        value={edit?.litres ?? null}
                        placeholder={row.litres}
                        edited={edit?.litres != null}
                        onCommit={(v) => app.setRecapEdit(row.immat, { litres: v ?? undefined })}
                      />
                    </td>
                    <td className="num">
                      {row.conso == null ? (
                        <span style={{ color: 'var(--ink-3)' }}>—</span>
                      ) : (
                        <span className={`chip ${outOfRange ? 'warn' : 'ok'}`}>{num(row.conso, 2)}</span>
                      )}
                    </td>
                    <td className="num">{row.adblue > 0 ? num(row.adblue, 2) : '—'}</td>
                    <td className="num">
                      {noFuel ? <span className="chip bad">0</span> : row.txCount}
                    </td>
                    {row.history.map((h) => (
                      <td key={h.quarter} className="num" style={{ color: 'var(--ink-2)' }}>
                        {h.conso != null ? num(h.conso, 2) : '—'}
                      </td>
                    ))}
                    <td>
                      {(edit?.km != null || edit?.litres != null) && (
                        <button
                          className="btn sm ghost"
                          onClick={() => app.setRecapEdit(row.immat, null)}
                          title="Revenir aux valeurs calculées"
                        >
                          ↺
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>TOTAL</td>
                <td className="num">{num(totalKm)}</td>
                <td className="num">{num(totalL, 2)}</td>
                <td className="num">{totalConso != null ? num(totalConso, 2) : '—'}</td>
                <td className="num">{num(recap.reduce((s, r) => s + r.adblue, 0), 2)}</td>
                <td className="num">{recap.reduce((s, r) => s + r.txCount, 0)}</td>
                {quarters.map((q) => (
                  <td key={q} />
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Contenu du fichier Excel" hint="Quatre onglets, prêts à être transmis.">
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.9 }}>
          <li>
            <strong>Récapitulatif</strong> — le tableau ci-dessus, avec totaux, historique des
            trimestres archivés et mise en évidence des valeurs corrigées ou hors plage.
          </li>
          <li>
            <strong>Détail transactions</strong> — chaque plein, avec l'immatriculation saisie,
            l'immatriculation retenue et l'origine de l'affectation. C'est la pièce justificative.
          </li>
          <li>
            <strong>Anomalies</strong> — la liste des contrôles, pour tracer ce qui a été vu et traité.
          </li>
          <li>
            <strong>Méthode</strong> — les règles de calcul appliquées, pour que le destinataire du
            fichier comprenne comment les chiffres ont été obtenus.
          </li>
        </ul>
      </Card>
    </>
  );
}
