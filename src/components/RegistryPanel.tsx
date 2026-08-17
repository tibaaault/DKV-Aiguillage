import { useRef } from 'react';
import { Card, Empty } from './common';
import type { AppState } from '../state';
import type { Category } from '../lib/model';
import { formatImmat } from '../lib/normalize';
import { downloadBlob, exportState, importState } from '../lib/storage';

/** Referentiel vehicules, cartes carburant, reglages et sauvegarde de la configuration. */
export function RegistryPanel({ app }: { app: AppState }) {
  const vehicles = [...app.engine.vehicles.values()].sort(
    (a, b) => Number(b.ticpe) - Number(a.ticpe) || a.label.localeCompare(b.label, 'fr'),
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const cards = [...app.engine.cardMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      <p className="intro">
        Ces informations sont conservées dans votre navigateur d'un trimestre à l'autre. Renseignez
        la région et la catégorie une seule fois : elles alimenteront automatiquement tous les
        récapitulatifs suivants.
      </p>

      <Card
        title="Référentiel véhicules"
        hint="Les camions du relevé kilométrique sont dans le périmètre TICPE ; les autres véhicules apparaissent en dessous."
        flush
      >
        {vehicles.length === 0 ? (
          <Empty icon="🚛" title="Aucun véhicule connu">
            Importez le relevé kilométrique pour alimenter le référentiel.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Immatriculation</th>
                  <th>Code flotte</th>
                  <th>Région</th>
                  <th>Catégorie</th>
                  <th>Périmètre TICPE</th>
                  <th>Origine</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.immat}>
                    <td>
                      <strong>{v.label}</strong>
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        style={{ textAlign: 'left', width: 100 }}
                        value={v.fleetCode}
                        onChange={(e) => app.updateVehicle(v.immat, { fleetCode: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        style={{ textAlign: 'left', width: 190 }}
                        value={v.region}
                        placeholder="ex. HAUTS DE FRANCE"
                        onChange={(e) => app.updateVehicle(v.immat, { region: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="assign"
                        value={v.category}
                        onChange={(e) => app.updateVehicle(v.immat, { category: e.target.value as Category })}
                      >
                        <option value="">—</option>
                        <option value="CD">CD — courte distance</option>
                        <option value="MD">MD — moyenne distance</option>
                        <option value="LD">LD — longue distance</option>
                      </select>
                    </td>
                    <td>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={v.ticpe}
                          onChange={(e) => app.updateVehicle(v.immat, { ticpe: e.target.checked })}
                        />
                        <span className={`chip ${v.ticpe ? 'ok' : 'neutral'}`}>
                          {v.ticpe ? 'dans le périmètre' : 'exclu'}
                        </span>
                      </label>
                    </td>
                    <td>
                      <span className="chip neutral">{v.auto ? 'détecté' : 'saisi'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Cartes carburant"
        hint="Le rattachement d'une carte à un camion est déduit des données. Corrigez-le si une carte a changé de véhicule."
        flush
      >
        {cards.length === 0 ? (
          <Empty icon="💳" title="Aucune carte identifiée" />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Numéro de carte</th>
                  <th>Détecté automatiquement</th>
                  <th>Rattachement retenu</th>
                  <th className="num">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map(([card, immat]) => {
                  const learned = app.engine.learnedCards.get(card);
                  const overridden = app.persisted.cardMap[card] != null;
                  const count = app.engine.resolved.filter((t) => t.card === card).length;
                  return (
                    <tr key={card}>
                      <td className="mono">{card}</td>
                      <td>{learned ? formatImmat(learned) : '—'}</td>
                      <td>
                        <select
                          className={`assign${overridden ? ' changed' : ''}`}
                          value={immat}
                          onChange={(e) => app.setCardMapping(card, e.target.value)}
                        >
                          <option value="">— aucun —</option>
                          {vehicles.map((v) => (
                            <option key={v.immat} value={v.immat}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Seuils de contrôle" hint="Ajustez si votre flotte sort naturellement de ces bornes.">
          <div className="form-row">
            <div className="field">
              <label htmlFor="conso-min">Consommation minimale plausible</label>
              <input
                id="conso-min"
                type="number"
                value={app.persisted.settings.consoMin}
                onChange={(e) => app.updateSettings({ consoMin: Number(e.target.value) })}
              />
              <small>L/100 km — en dessous, une alerte est levée.</small>
            </div>
            <div className="field">
              <label htmlFor="conso-max">Consommation maximale plausible</label>
              <input
                id="conso-max"
                type="number"
                value={app.persisted.settings.consoMax}
                onChange={(e) => app.updateSettings({ consoMax: Number(e.target.value) })}
              />
              <small>L/100 km — au-dessus, une alerte est levée.</small>
            </div>
            <div className="field">
              <label htmlFor="odo-tol">Tolérance sur les compteurs</label>
              <input
                id="odo-tol"
                type="number"
                step={100}
                value={app.persisted.settings.odometerTolerance}
                onChange={(e) => app.updateSettings({ odometerTolerance: Number(e.target.value) })}
              />
              <small>km de marge autour de la plage d'un camion.</small>
            </div>
          </div>
        </Card>

        <Card title="Sauvegarde de la configuration" hint="Pour changer d'ordinateur ou repartir de zéro.">
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13 }}>
            Le référentiel, les règles, les réaffectations et l'historique des trimestres sont
            enregistrés dans ce navigateur. Exportez-les pour les transférer sur un autre poste.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() =>
                downloadBlob(exportState(app.persisted), `Configuration TICPE ${new Date().toISOString().slice(0, 10)}.json`)
              }
            >
              ⬇ Exporter la configuration
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ⬆ Importer une configuration
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  app.replaceState(importState(await file.text()));
                } catch (err) {
                  app.notify(`Import impossible : ${(err as Error).message}`, 'error');
                }
              }}
            />
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('Effacer le référentiel, les règles, les corrections et l’historique ?')) {
                  app.resetAll();
                }
              }}
            >
              Tout effacer
            </button>
          </div>
        </Card>
      </div>

      {app.persisted.history.length > 0 && (
        <Card title="Trimestres archivés" hint="Alimentent les colonnes d'historique du récapitulatif." flush>
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Trimestre</th>
                  <th>Archivé le</th>
                  <th className="num">Véhicules</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...app.persisted.history].reverse().map((h) => (
                  <tr key={h.quarter}>
                    <td>
                      <strong>{h.quarter}</strong>
                    </td>
                    <td>{new Date(h.savedAt).toLocaleDateString('fr-FR')}</td>
                    <td className="num">{h.rows.length}</td>
                    <td>
                      <button className="btn sm ghost danger" onClick={() => app.removeQuarter(h.quarter)}>
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
