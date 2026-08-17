// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';

/**
 * Test de fumee : verifie que l'application se monte reellement, que la
 * navigation entre etapes fonctionne et que les etapes dependantes des donnees
 * restent verrouillees tant qu'aucun fichier n'est charge.
 */
describe('App', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React signale l'absence d'environnement de test si ce drapeau manque.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      root.render(<App />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('affiche l ecran d import au demarrage', () => {
    expect(container.textContent).toContain('DKV Aiguillage');
    expect(container.textContent).toContain('Relevé kilométrique TICPE');
    expect(container.textContent).toContain('Exports carburant DKV');
    expect(container.textContent).toContain('aucun fichier chargé');
  });

  it('verrouille les etapes qui exigent des donnees', () => {
    const steps = [...container.querySelectorAll<HTMLButtonElement>('.step')];
    const labels = steps.map((s) => s.textContent ?? '');

    const controler = steps[labels.findIndex((l) => l.includes('Contrôler'))];
    const referentiel = steps[labels.findIndex((l) => l.includes('Référentiel'))];

    expect(controler.disabled).toBe(true);
    // Le referentiel reste accessible : on peut le preparer avant tout import.
    expect(referentiel.disabled).toBe(false);
  });

  it('ouvre le referentiel et ses reglages', () => {
    const steps = [...container.querySelectorAll<HTMLButtonElement>('.step')];
    const referentiel = steps.find((s) => s.textContent?.includes('Référentiel'))!;

    act(() => {
      referentiel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Référentiel véhicules');
    expect(container.textContent).toContain('Seuils de contrôle');
    expect(container.textContent).toContain('Sauvegarde de la configuration');
  });

  it('conserve les reglages modifies dans le navigateur', () => {
    const steps = [...container.querySelectorAll<HTMLButtonElement>('.step')];
    const referentiel = steps.find((s) => s.textContent?.includes('Référentiel'))!;
    act(() => {
      referentiel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector<HTMLInputElement>('#conso-max')!;
    expect(input.value).toBe('45');

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '50');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(JSON.parse(localStorage.getItem('ticpe.state.v1')!).settings.consoMax).toBe(50);
  });
});
