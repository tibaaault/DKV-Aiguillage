import { describe, expect, it } from 'vitest';
import {
  excelSerialToDate,
  extractFleetCode,
  formatImmat,
  headerKey,
  normalizeImmat,
  parseDate,
  parseNumber,
  quarterKey,
  stableHash,
} from './normalize';

describe('normalizeImmat', () => {
  it('produit la meme cle quel que soit le formatage', () => {
    const expected = 'FV193CR';
    for (const variant of ['FV-193-CR', 'FV193CR', 'fv 193 cr', ' FV.193.CR ', 'FV_193_CR']) {
      expect(normalizeImmat(variant)).toBe(expected);
    }
  });

  it('rejette les libelles parasites des exports', () => {
    for (const junk of ['RELAIS 1', 'RELAIS', '', '   ', 'NA', 'DIVERS']) {
      expect(normalizeImmat(junk)).toBe('');
    }
  });

  it('rejette les valeurs de longueur invraisemblable', () => {
    expect(normalizeImmat('AB12')).toBe('');
    expect(normalizeImmat('ABCDEFGHIJKLMNOP')).toBe('');
  });
});

describe('formatImmat', () => {
  it('remet le format SIV', () => {
    expect(formatImmat('FV193CR')).toBe('FV-193-CR');
    expect(formatImmat('GW392QG')).toBe('GW-392-QG');
  });

  it('laisse intact ce qu il ne reconnait pas', () => {
    expect(formatImmat('ABC123XYZ')).toBe('ABC123XYZ');
  });
});

describe('extractFleetCode', () => {
  it('lit les differentes ecritures du code flotte', () => {
    expect(extractFleetCode('74303')).toBe('74303');
    expect(extractFleetCode('ET-502-NJ - 79418')).toBe('79418');
    expect(extractFleetCode('PF-96501')).toBe('96501');
  });

  it('ne confond pas une immat SIV avec un code', () => {
    // Les 3 chiffres d'une immat sont trop courts pour etre pris pour un code flotte.
    expect(extractFleetCode('FV-193-CR')).toBe('');
  });

  it('renvoie une chaine vide sur une valeur absente', () => {
    expect(extractFleetCode('')).toBe('');
    expect(extractFleetCode(null)).toBe('');
  });
});

describe('parseNumber', () => {
  it('accepte les ecritures francaise et anglaise', () => {
    expect(parseNumber('1 234,56')).toBeCloseTo(1234.56);
    expect(parseNumber('1234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumber(42)).toBe(42);
  });

  it('renvoie null sur une valeur non numerique', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('parseDate', () => {
  it('convertit un numero de serie Excel', () => {
    // 46024 correspond au 2 janvier 2026 dans le calendrier Excel.
    expect(parseDate(46024)?.toISOString().slice(0, 10)).toBe('2026-01-02');
    expect(excelSerialToDate(45658).toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('lit le format francais du releve kilometrique', () => {
    const d = parseDate('08/01/2026 04:40:00');
    expect(d?.toISOString()).toBe('2026-01-08T04:40:00.000Z');
  });

  it('lit une date ISO', () => {
    expect(parseDate('2026-03-31')?.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('refuse un nombre hors plage de dates plausibles', () => {
    expect(parseDate(5)).toBeNull();
    expect(parseDate(999999)).toBeNull();
  });
});

describe('quarterKey', () => {
  it('numerote correctement les trimestres', () => {
    expect(quarterKey(new Date('2026-01-02T00:00:00Z'))).toBe('2026-T1');
    expect(quarterKey(new Date('2026-03-31T00:00:00Z'))).toBe('2026-T1');
    expect(quarterKey(new Date('2026-04-01T00:00:00Z'))).toBe('2026-T2');
    expect(quarterKey(new Date('2025-12-31T00:00:00Z'))).toBe('2025-T4');
  });
});

describe('headerKey', () => {
  it('neutralise accents, ponctuation et casse', () => {
    expect(headerKey("N° d'immatriculation")).toBe('ndimmatriculation');
    expect(headerKey('Quantité')).toBe('quantite');
    expect(headerKey('Centre de coûts 2')).toBe('centredecouts2');
    expect(headerKey('No. de carte/boîte')).toBe('nodecarteboite');
  });
});

describe('stableHash', () => {
  it('est stable et discriminant', () => {
    expect(stableHash(['a', 1])).toBe(stableHash(['a', 1]));
    expect(stableHash(['a', 1])).not.toBe(stableHash(['a', 2]));
  });
});
