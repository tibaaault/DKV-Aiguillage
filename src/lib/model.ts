/** Modele de donnees partage par toute l'application. */

export type Category = 'CD' | 'MD' | 'LD' | '';

/** Une ligne du releve kilometrique TICPE : la source de verite pour les km. */
export interface KmRecord {
  /** Immatriculation canonique (lettres/chiffres, majuscules). */
  immat: string;
  /** Immatriculation telle qu'ecrite dans le fichier. */
  rawImmat: string;
  /** Code flotte extrait de la colonne « Code » (ex. 96501). */
  fleetCode: string;
  start: Date | null;
  end: Date | null;
  kmStart: number | null;
  kmEnd: number | null;
  /** Km parcourus tels que fournis par le fichier. */
  km: number | null;
  sourceLine: number;
}

/** Famille de produit consolidee, deduite de « Groupe de produits ». */
export type ProductFamily = 'gazole' | 'adblue' | 'essence' | 'peage' | 'autre';

/** Une transaction carburant issue d'un export DKV. */
export interface FuelTransaction {
  /** Identifiant stable entre deux imports du meme fichier. */
  id: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  /** Numero de carte / boitier : rattache au vehicule, pas au chauffeur. */
  card: string;
  rawImmat: string;
  /** Immatriculation declaree, normalisee. Vide si illisible. */
  declaredImmat: string;
  /** Code flotte (centre de couts) quand l'export le fournit. */
  fleetCode: string;
  date: Date | null;
  productGroup: string;
  productType: string;
  family: ProductFamily;
  /** Volume dans l'unite d'origine (litres pour les carburants). */
  volume: number;
  unit: string;
  amount: number | null;
  /** Kilometrage saisi par le chauffeur a la pompe. Tres peu fiable. */
  odometer: number | null;
  city: string;
  station: string;
}

/**
 * Valeur d'affectation signifiant « exclure cette ligne du calcul ». Une chaine
 * vide ne conviendrait pas : elle est indistinguable d'une absence de correction,
 * et la transaction retomberait sur l'immatriculation declaree.
 */
export const EXCLUDED_IMMAT = '__EXCLU__';

/** Provenance de l'affectation d'une transaction a un vehicule. */
export type AssignmentSource =
  | 'declaree' // immat lisible et connue
  | 'carte' // deduite du numero de carte
  | 'code-flotte' // deduite du centre de couts
  | 'regle' // regle de correction en masse
  | 'manuelle' // reaffectation ponctuelle
  | 'aucune'; // non rattachable

export interface ResolvedTransaction extends FuelTransaction {
  /** Vehicule finalement retenu (immat canonique), vide si non rattache. */
  assignedImmat: string;
  assignmentSource: AssignmentSource;
  /** Vrai si l'affectation differe de l'immat declaree par le chauffeur. */
  reassigned: boolean;
}

/** Fiche vehicule du referentiel, memorisee d'un trimestre a l'autre. */
export interface Vehicle {
  immat: string;
  label: string;
  fleetCode: string;
  region: string;
  category: Category;
  /** Faux pour les vehicules legers hors perimetre TICPE. */
  ticpe: boolean;
  /** Renseignee automatiquement, modifiable. */
  auto: boolean;
}

/** Regle de correction en masse, rejouee a chaque recalcul. */
export interface Rule {
  id: string;
  enabled: boolean;
  label: string;
  /** Critere : carte, immat declaree ou code flotte. */
  matchField: 'card' | 'declaredImmat' | 'fleetCode';
  matchValue: string;
  /** Bornes de dates optionnelles (incluses), au format aaaa-mm-jj. */
  dateFrom: string;
  dateTo: string;
  /** Restreint la regle a une famille de produit. */
  family: ProductFamily | '';
  /** Immatriculation cible. */
  targetImmat: string;
}

export type AnomalySeverity = 'critique' | 'avertissement' | 'info';

export interface Anomaly {
  id: string;
  code: AnomalyCode;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  /** Immat concernee, quand l'anomalie porte sur un vehicule. */
  immat?: string;
  /** Transactions concernees, quand l'anomalie porte sur des lignes. */
  transactionIds?: string[];
  /** Action proposee, exploitable en un clic. */
  suggestion?: Suggestion;
}

export type AnomalyCode =
  | 'hors-periode'
  | 'immat-illisible'
  | 'immat-inconnue'
  | 'km-sans-carburant'
  | 'carburant-sans-km'
  | 'conso-aberrante'
  | 'odometre-incoherent'
  | 'doublon'
  | 'volume-negatif'
  | 'km-incoherent'
  | 'plein-hors-activite';

export interface Suggestion {
  kind: 'reassign' | 'ignore' | 'review';
  targetImmat?: string;
  transactionIds: string[];
  confidence: number;
  reason: string;
}

/** Ligne finale du recapitulatif, par vehicule. */
export interface RecapRow {
  immat: string;
  label: string;
  region: string;
  category: Category;
  fleetCode: string;
  kmStart: number | null;
  kmEnd: number | null;
  /** Km retenus (valeur du fichier, ou correction manuelle). */
  km: number | null;
  /** Litres de gazole retenus (somme des transactions affectees, ou correction). */
  litres: number;
  /** Litres d'AdBlue, pour information. */
  adblue: number;
  /** Consommation en L/100 km, nulle si le calcul n'a pas de sens. */
  conso: number | null;
  /** Nombre de transactions gazole affectees. */
  txCount: number;
  /** Vrai si km ou litres ont ete saisis a la main. */
  edited: boolean;
  /** Consommations des trimestres precedents, du plus recent au plus ancien. */
  history: Array<{ quarter: string; conso: number | null }>;
  flags: AnomalyCode[];
}

/** Corrections saisies a la main sur le recapitulatif. */
export interface RecapEdit {
  km?: number;
  litres?: number;
  note?: string;
}

/** Instantane d'un trimestre valide, conserve pour l'historique de consommation. */
export interface QuarterSnapshot {
  quarter: string;
  savedAt: string;
  rows: Array<{ immat: string; km: number | null; litres: number; conso: number | null }>;
}

/** Etat complet persiste dans le navigateur. */
export interface PersistedState {
  version: number;
  vehicles: Record<string, Vehicle>;
  /** carte -> immat, appris puis corrige par l'utilisateur. */
  cardMap: Record<string, string>;
  rules: Rule[];
  /** id de transaction -> immat cible. */
  overrides: Record<string, string>;
  recapEdits: Record<string, RecapEdit>;
  history: QuarterSnapshot[];
  settings: Settings;
}

export interface Settings {
  /** Bornes de plausibilite de la consommation, en L/100 km. */
  consoMin: number;
  consoMax: number;
  /** Tolerance en km appliquee aux plages d'odometre. */
  odometerTolerance: number;
  /** Restreint les transactions retenues a la periode du releve kilometrique. */
  restrictToPeriod: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  consoMin: 15,
  consoMax: 45,
  odometerTolerance: 1500,
  restrictToPeriod: true,
};

/** Classe un « Groupe de produits » DKV dans une famille exploitable. */
export function classifyProduct(group: string, type: string): ProductFamily {
  const s = `${group} ${type}`.toLowerCase();
  if (s.includes('adblue')) return 'adblue';
  if (s.includes('gazole') || s.includes('diesel') || s.includes('gasoil')) return 'gazole';
  if (s.includes('essence') || s.includes('ron ') || s.includes('sp95') || s.includes('sp98')) return 'essence';
  if (s.includes('peage') || s.includes('péage') || s.includes('toll')) return 'peage';
  return 'autre';
}

export const FAMILY_LABEL: Record<ProductFamily, string> = {
  gazole: 'Gazole',
  adblue: 'AdBlue',
  essence: 'Essence',
  peage: 'Péage',
  autre: 'Autre',
};
