import { DEFAULT_SETTINGS, type PersistedState } from './model';

const KEY = 'ticpe.state.v1';
const CURRENT_VERSION = 1;

export function emptyState(): PersistedState {
  return {
    version: CURRENT_VERSION,
    vehicles: {},
    cardMap: {},
    rules: [],
    overrides: {},
    recapEdits: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Recharge l'etat depuis le navigateur, en tolerant un stockage absent ou corrompu. */
export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...emptyState(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      version: CURRENT_VERSION,
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Sauvegarde impossible', err);
  }
}

/** Exporte la configuration (referentiel, regles, corrections) dans un fichier JSON. */
export function exportState(state: PersistedState): Blob {
  return new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
}

/** Relit une configuration exportee. Leve une erreur si le fichier n'est pas reconnu. */
export function importState(text: string): PersistedState {
  const parsed = JSON.parse(text) as Partial<PersistedState>;
  if (typeof parsed !== 'object' || parsed == null || !('vehicles' in parsed)) {
    throw new Error('Fichier de configuration non reconnu.');
  }
  return {
    ...emptyState(),
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    version: CURRENT_VERSION,
  };
}

/** Declenche le telechargement d'un blob cote navigateur. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
