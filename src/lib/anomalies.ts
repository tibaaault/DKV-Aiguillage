import type { Anomaly, RecapRow, ResolvedTransaction, Settings } from './model';
import { type EngineOutput, odometerScore, sumByVehicle, suggestVehicles } from './engine';
import { formatDate, formatImmat, quarterKey } from './normalize';

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Passe en revue les donnees consolidees et remonte tout ce qui doit etre verifie
 * a la main. Chaque anomalie porte, quand c'est possible, une action applicable
 * en un clic.
 */
export function detectAnomalies(
  output: EngineOutput,
  recap: RecapRow[],
  settings: Settings,
  duplicateIds: string[],
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const { resolved, kmByImmat, vehicles } = output;
  const litresByImmat = sumByVehicle(resolved, 'gazole');

  // ---------------------------------------------------------------- periode
  // Le trimestre de reference est celui du releve kilometrique.
  const kmDates = [...kmByImmat.values()].flatMap((r) => [r.start, r.end]).filter((d): d is Date => d != null);
  if (kmDates.length) {
    const refQuarters = new Set(kmDates.map(quarterKey));
    const offenders = new Map<string, string[]>();
    for (const tx of resolved) {
      if (!tx.date) continue;
      const q = quarterKey(tx.date);
      if (!refQuarters.has(q)) {
        const key = `${tx.sourceFile} — ${q}`;
        const list = offenders.get(key) ?? [];
        list.push(tx.id);
        offenders.set(key, list);
      }
    }
    for (const [key, ids] of offenders) {
      const [file, quarter] = key.split(' — ');
      anomalies.push({
        id: `periode:${key}`,
        code: 'hors-periode',
        severity: 'critique',
        title: `${ids.length} transaction(s) hors trimestre dans « ${file} »`,
        detail:
          `Ces lignes datent du trimestre ${quarter}, alors que le relevé kilométrique couvre ` +
          `${[...refQuarters].join(', ')}. Vérifiez que le bon export a été téléchargé : ` +
          `un fichier d'une autre période fausserait tous les totaux.`,
        transactionIds: ids,
        suggestion: {
          kind: 'ignore',
          transactionIds: ids,
          confidence: 0.9,
          reason: 'Exclure ces lignes du calcul',
        },
      });
    }
  }

  // -------------------------------------------------------- immats illisibles
  // Cas favorable : l'immatriculation etait illisible mais la carte ou le code
  // flotte a permis de rattacher la ligne. On le signale pour information.
  const recovered = resolved.filter(
    (t) => !t.declaredImmat && t.assignedImmat && t.family === 'gazole' && t.volume > 0,
  );
  if (recovered.length) {
    anomalies.push({
      id: 'immat:rattrapee',
      code: 'immat-illisible',
      severity: 'info',
      title: `${recovered.length} plein(s) sans immatriculation lisible ont été rattachés automatiquement`,
      detail: `Le numéro de carte ou le code flotte a permis d'identifier le camion. Aucune action nécessaire.`,
      transactionIds: recovered.map((t) => t.id),
    });
  }

  // ------------------------------- pleins non rattaches : identifier le vehicule
  // Une carte anonyme (« RELAIS 1 », cellule vide) reste rattachable : les compteurs
  // saisis a la pompe designent le camion, meme sans immatriculation.
  const orphansByCard = new Map<string, ResolvedTransaction[]>();
  for (const tx of resolved) {
    if (tx.family !== 'gazole' || tx.assignedImmat || tx.volume <= 0) continue;
    // Une ligne volontairement exclue n'est pas un probleme a resignaler.
    if (tx.assignmentSource === 'manuelle') continue;
    const key = tx.card || '(sans carte)';
    const list = orphansByCard.get(key) ?? [];
    list.push(tx);
    orphansByCard.set(key, list);
  }
  for (const [card, list] of orphansByCard) {
    const votes = new Map<string, { count: number; score: number }>();
    let withOdometer = 0;
    for (const tx of list) {
      if (tx.odometer == null || tx.odometer <= 0) continue;
      withOdometer++;
      const best = suggestVehicles(tx, kmByImmat, vehicles, settings, litresByImmat)[0];
      if (!best) continue;
      const entry = votes.get(best.immat) ?? { count: 0, score: 0 };
      entry.count++;
      entry.score = Math.max(entry.score, best.score);
      votes.set(best.immat, entry);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1].count - a[1].count || b[1].score - a[1].score)[0];
    const litres = list.reduce((s, t) => s + t.volume, 0);
    const label = list[0].rawImmat || '(immatriculation vide)';

    if (winner && withOdometer > 0 && winner[1].count / withOdometer >= 0.5) {
      const confidence = Math.min(0.95, (winner[1].count / withOdometer) * winner[1].score);
      anomalies.push({
        id: `orphelins:${card}`,
        code: 'immat-illisible',
        severity: 'critique',
        title: `${list.length} plein(s) sous « ${label} » — ${nf1.format(litres)} L sans camion identifié`,
        detail:
          `La carte ${card} n'est associée à aucune immatriculation lisible. Sur ${withOdometer} pleins ` +
          `où le compteur a été saisi, ${winner[1].count} tombent dans la plage de ${formatImmat(winner[0])} ` +
          `(${nf.format(kmByImmat.get(winner[0])?.kmStart ?? 0)} – ${nf.format(kmByImmat.get(winner[0])?.kmEnd ?? 0)} km). ` +
          `Sans rattachement, ces litres ne comptent pour aucun camion.`,
        transactionIds: list.map((t) => t.id),
        suggestion: {
          kind: 'reassign',
          targetImmat: winner[0],
          transactionIds: list.map((t) => t.id),
          confidence,
          reason: `Réaffecter les ${list.length} pleins à ${formatImmat(winner[0])}`,
        },
      });
    } else {
      anomalies.push({
        id: `orphelins:${card}`,
        code: 'immat-illisible',
        severity: 'critique',
        title: `${list.length} plein(s) sous « ${label} » — ${nf1.format(litres)} L sans camion identifié`,
        detail:
          `La carte ${card} n'est associée à aucune immatriculation lisible, et les compteurs saisis ne ` +
          `permettent pas de désigner un camion. Rattachez cette carte dans le référentiel, ou affectez ` +
          `ces lignes à la main. En l'état, ces litres ne comptent pour aucun camion.`,
        transactionIds: list.map((t) => t.id),
      });
    }
  }

  // ------------------------- pleins hors de la periode d'activite du vehicule
  // Un plein posterieur a la fin du releve kilometrique gonfle la consommation :
  // les litres sont comptes alors que les kilometres correspondants manquent.
  const outsideWindow = new Map<string, { ids: string[]; litres: number; after: number; before: number }>();
  const ONE_DAY = 86400000;
  for (const tx of resolved) {
    if (tx.family !== 'gazole' || !tx.assignedImmat || !tx.date || tx.volume <= 0) continue;
    const record = kmByImmat.get(tx.assignedImmat);
    if (!record?.start || !record.end) continue;
    // Si le compteur saisi ne colle pas au vehicule, le probleme est l'affectation,
    // pas le releve kilometrique : c'est le detecteur d'echange de carte qui traite
    // ce cas. Sans ce garde-fou, on proposerait d'exclure des pleins qu'il faut en
    // realite reaffecter a un autre camion.
    if (tx.odometer != null && tx.odometer > 0) {
      if (odometerScore(record, tx.odometer, tx.date, settings.odometerTolerance) === 0) continue;
    }
    const t = tx.date.getTime();
    const isAfter = t > record.end.getTime() + ONE_DAY;
    const isBefore = t < record.start.getTime() - ONE_DAY;
    if (!isAfter && !isBefore) continue;
    const entry = outsideWindow.get(tx.assignedImmat) ?? { ids: [], litres: 0, after: 0, before: 0 };
    entry.ids.push(tx.id);
    entry.litres += tx.volume;
    if (isAfter) entry.after++;
    else entry.before++;
    outsideWindow.set(tx.assignedImmat, entry);
  }
  for (const [immat, entry] of outsideWindow) {
    const total = litresByImmat.get(immat) ?? 0;
    // On ignore les cas marginaux : un plein isole en bordure de periode n'est pas un signal.
    if (entry.litres < 100 || (total > 0 && entry.litres / total < 0.1)) continue;
    const record = kmByImmat.get(immat)!;
    anomalies.push({
      id: `hors-activite:${immat}`,
      code: 'plein-hors-activite',
      severity: 'avertissement',
      title: `${formatImmat(immat)} : ${entry.ids.length} plein(s) hors de sa période de relevé — ${nf1.format(entry.litres)} L`,
      detail:
        `Le relevé kilométrique de ce camion couvre du ${formatDate(record.start)} au ${formatDate(record.end)}, ` +
        `mais ${entry.after ? `${entry.after} plein(s) sont postérieurs` : ''}` +
        `${entry.after && entry.before ? ' et ' : ''}` +
        `${entry.before ? `${entry.before} plein(s) sont antérieurs` : ''} à cette période. ` +
        `Ces ${nf1.format(entry.litres)} L sont comptés sans les kilomètres correspondants, ce qui gonfle ` +
        `artificiellement la consommation. Soit le relevé kilométrique est incomplet, soit ces pleins ` +
        `appartiennent à un autre camion.`,
      immat,
      transactionIds: entry.ids,
      suggestion: {
        kind: 'ignore',
        transactionIds: entry.ids,
        confidence: 0.6,
        reason: `Exclure ces ${entry.ids.length} pleins du calcul`,
      },
    });
  }

  // ---------------------------------------------- gazole hors perimetre TICPE
  const outside = new Map<string, { litres: number; ids: string[] }>();
  for (const tx of resolved) {
    if (tx.family !== 'gazole' || tx.volume <= 0) continue;
    const immat = tx.assignedImmat;
    if (!immat || vehicles.get(immat)?.ticpe) continue;
    const entry = outside.get(immat) ?? { litres: 0, ids: [] };
    entry.litres += tx.volume;
    entry.ids.push(tx.id);
    outside.set(immat, entry);
  }
  for (const [immat, entry] of outside) {
    anomalies.push({
      id: `hors-perimetre:${immat}`,
      code: 'immat-inconnue',
      severity: 'avertissement',
      title: `${formatImmat(immat)} consomme ${nf1.format(entry.litres)} L de gazole hors périmètre TICPE`,
      detail:
        `Ce véhicule n'apparaît pas dans le relevé kilométrique. Soit il est normalement exclu ` +
        `(véhicule léger, véhicule d'une autre région), soit son relevé km manque, soit sa carte ` +
        `sert en réalité à ravitailler un camion du périmètre.`,
      immat,
      transactionIds: entry.ids,
    });
  }

  // --------------------------------------- camions qui roulent sans carburant
  for (const row of recap) {
    if (!vehicles.get(row.immat)?.ticpe) continue;
    if ((row.km ?? 0) > 0 && row.litres === 0) {
      const km = kmByImmat.get(row.immat);
      // On cherche qui a bien pu payer le gazole de ce camion.
      const culprits = km ? findOdometerMatches(output, row.immat, settings) : [];
      anomalies.push({
        id: `sans-carburant:${row.immat}`,
        code: 'km-sans-carburant',
        severity: 'critique',
        title: `${row.label} a parcouru ${nf.format(row.km ?? 0)} km sans aucun plein à son nom`,
        detail: culprits.length
          ? `Des pleins enregistrés sous ${culprits.map((c) => formatImmat(c.immat)).join(', ')} affichent ` +
            `des compteurs qui correspondent à la plage de ce camion (${nf.format(km?.kmStart ?? 0)} – ` +
            `${nf.format(km?.kmEnd ?? 0)} km). Il s'agit très probablement d'un échange de carte.`
          : `Aucun plein ne lui est rattaché. Vérifiez si sa carte a été utilisée sous une autre immatriculation.`,
        immat: row.immat,
        transactionIds: culprits.flatMap((c) => c.ids),
        suggestion: culprits.length
          ? {
              kind: 'reassign',
              targetImmat: row.immat,
              transactionIds: culprits.flatMap((c) => c.ids),
              confidence: culprits[0].confidence,
              reason: `Réaffecter ${culprits.flatMap((c) => c.ids).length} plein(s) à ${row.label}`,
            }
          : undefined,
      });
    }

    if ((row.km ?? 0) === 0 && row.litres > 0) {
      anomalies.push({
        id: `sans-km:${row.immat}`,
        code: 'carburant-sans-km',
        severity: 'avertissement',
        title: `${row.label} : ${nf1.format(row.litres)} L consommés mais aucun kilométrage`,
        detail: `Le relevé kilométrique ne fournit pas de distance pour ce véhicule, la consommation ne peut pas être calculée.`,
        immat: row.immat,
      });
    }
  }

  // ------------------------------------------------------ consos improbables
  for (const row of recap) {
    if (row.conso == null || row.litres === 0 || !row.km) continue;
    if (row.conso < settings.consoMin || row.conso > settings.consoMax) {
      const previous = row.history.find((h) => h.conso != null)?.conso ?? null;
      anomalies.push({
        id: `conso:${row.immat}`,
        code: 'conso-aberrante',
        severity: row.conso > settings.consoMax * 1.5 || row.conso < settings.consoMin / 2 ? 'critique' : 'avertissement',
        title: `${row.label} : ${nf1.format(row.conso)} L/100 km`,
        detail:
          `Attendu entre ${settings.consoMin} et ${settings.consoMax} L/100 km` +
          (previous != null ? ` (${nf1.format(previous)} au trimestre précédent)` : '') +
          `. ${nf1.format(row.litres)} L pour ${nf.format(row.km)} km : ` +
          (row.conso > settings.consoMax
            ? `soit des pleins d'un autre véhicule sont comptés ici, soit des kilomètres manquent.`
            : `soit des pleins manquent, soit des kilomètres sont comptés en trop.`),
        immat: row.immat,
      });
    }
  }

  // -------------------------------------------- compteurs incoherents a la pompe
  const odoOffenders = new Map<string, { ids: string[]; best: string; confidence: number }>();
  for (const tx of resolved) {
    if (tx.family !== 'gazole' || !tx.assignedImmat || tx.odometer == null || tx.odometer <= 0) continue;
    const own = kmByImmat.get(tx.assignedImmat);
    if (!own || own.kmStart == null || own.kmEnd == null) continue;

    const fits = odometerScore(own, tx.odometer, tx.date, settings.odometerTolerance) > 0;
    if (fits) continue;

    // Le compteur ne colle pas au vehicule declare : un autre camion correspond-il ?
    const candidates = suggestVehicles(tx, kmByImmat, vehicles, settings, litresByImmat).filter(
      (c) => c.immat !== tx.assignedImmat,
    );
    if (!candidates.length) continue;

    const key = `${tx.assignedImmat}->${candidates[0].immat}`;
    const entry = odoOffenders.get(key) ?? { ids: [], best: candidates[0].immat, confidence: candidates[0].score };
    entry.ids.push(tx.id);
    entry.confidence = Math.max(entry.confidence, candidates[0].score);
    odoOffenders.set(key, entry);
  }
  for (const [key, entry] of odoOffenders) {
    const [from] = key.split('->');
    // Une seule ligne isolee releve plus de la faute de frappe que de l'echange de carte.
    if (entry.ids.length < 2 && entry.confidence < 0.7) continue;
    anomalies.push({
      id: `odo:${key}`,
      code: 'odometre-incoherent',
      severity: entry.ids.length >= 3 ? 'critique' : 'avertissement',
      title: `${entry.ids.length} plein(s) sous ${formatImmat(from)} avec le compteur de ${formatImmat(entry.best)}`,
      detail:
        `Les kilométrages saisis à la pompe ne correspondent pas à la plage de ${formatImmat(from)} ` +
        `mais tombent dans celle de ${formatImmat(entry.best)}. Signature typique d'un échange de carte entre chauffeurs.`,
      immat: from,
      transactionIds: entry.ids,
      suggestion: {
        kind: 'reassign',
        targetImmat: entry.best,
        transactionIds: entry.ids,
        confidence: entry.confidence,
        reason: `Réaffecter à ${formatImmat(entry.best)}`,
      },
    });
  }

  // ----------------- compteurs ne correspondant a aucun camion du perimetre
  // Cas distinct de l'echange de carte : ici le compteur saisi ne colle ni au
  // vehicule credite, ni a aucun autre camion du releve. Les litres sont donc
  // comptes pour un camion qui ne les a pas consommes, sans candidat de repli.
  const unmatched = new Map<string, { ids: string[]; litres: number; min: number; max: number }>();
  for (const tx of resolved) {
    if (tx.family !== 'gazole' || !tx.assignedImmat || tx.volume <= 0) continue;
    if (tx.assignmentSource === 'manuelle') continue;
    if (tx.odometer == null || tx.odometer <= 0) continue;

    const own = kmByImmat.get(tx.assignedImmat);
    if (!own || own.kmStart == null || own.kmEnd == null) continue;
    if (odometerScore(own, tx.odometer, tx.date, settings.odometerTolerance) > 0) continue;

    const matchesAnother = [...kmByImmat].some(
      ([immat, record]) =>
        immat !== tx.assignedImmat &&
        vehicles.get(immat)?.ticpe &&
        odometerScore(record, tx.odometer!, tx.date, settings.odometerTolerance) > 0,
    );
    if (matchesAnother) continue;

    const entry = unmatched.get(tx.assignedImmat) ?? {
      ids: [],
      litres: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
    };
    entry.ids.push(tx.id);
    entry.litres += tx.volume;
    entry.min = Math.min(entry.min, tx.odometer);
    entry.max = Math.max(entry.max, tx.odometer);
    unmatched.set(tx.assignedImmat, entry);
  }
  for (const [immat, entry] of unmatched) {
    // Une saisie isolee releve de la faute de frappe, pas d'un vehicule fantome.
    if (entry.ids.length < 3 || entry.litres < 100) continue;
    const record = kmByImmat.get(immat)!;
    anomalies.push({
      id: `compteur-orphelin:${immat}`,
      code: 'odometre-incoherent',
      severity: 'critique',
      title: `${formatImmat(immat)} : ${entry.ids.length} plein(s) au compteur d'un véhicule inconnu — ${nf1.format(entry.litres)} L`,
      detail:
        `Ces pleins affichent des compteurs de ${nf.format(entry.min)} à ${nf.format(entry.max)} km, alors que ` +
        `${formatImmat(immat)} évolue entre ${nf.format(record.kmStart ?? 0)} et ${nf.format(record.kmEnd ?? 0)} km. ` +
        `Aucun autre camion du relevé ne correspond non plus : il s'agit vraisemblablement d'un véhicule absent ` +
        `du relevé kilométrique (véhicule neuf, véhicule de remplacement, autre région). ` +
        `Tant qu'ils restent rattachés à ${formatImmat(immat)}, ces ${nf1.format(entry.litres)} L gonflent sa consommation.`,
      immat,
      transactionIds: entry.ids,
      suggestion: {
        kind: 'ignore',
        transactionIds: entry.ids,
        confidence: 0.75,
        reason: `Exclure ces ${entry.ids.length} pleins du calcul`,
      },
    });
  }

  // ------------------------------------------------------------------ doublons
  if (duplicateIds.length) {
    anomalies.push({
      id: 'doublons',
      code: 'doublon',
      severity: 'avertissement',
      title: `${duplicateIds.length} transaction(s) en double entre les fichiers importés`,
      detail: `Deux exports se recouvrent. Les doublons ont été écartés automatiquement pour ne pas compter les litres deux fois.`,
      transactionIds: duplicateIds,
    });
  }

  // ------------------------------------------------------- volumes aberrants
  const negatives = resolved.filter((t) => t.family === 'gazole' && t.volume < 0);
  if (negatives.length) {
    anomalies.push({
      id: 'volumes-negatifs',
      code: 'volume-negatif',
      severity: 'info',
      title: `${negatives.length} ligne(s) de gazole à volume négatif`,
      detail: `Il s'agit normalement d'avoirs ou d'annulations. Ils sont déduits du total, ce qui est le comportement attendu.`,
      transactionIds: negatives.map((t) => t.id),
    });
  }

  // ------------------------------------------------- coherence des compteurs km
  for (const km of kmByImmat.values()) {
    if (km.km != null && km.kmStart != null && km.kmEnd != null) {
      const computed = km.kmEnd - km.kmStart;
      if (Math.abs(computed - km.km) > 1) {
        anomalies.push({
          id: `km-incoherent:${km.immat}`,
          code: 'km-incoherent',
          severity: 'avertissement',
          title: `${formatImmat(km.immat)} : écart entre les compteurs et les km annoncés`,
          detail:
            `Compteurs ${nf.format(km.kmStart)} → ${nf.format(km.kmEnd)} soit ${nf.format(computed)} km, ` +
            `alors que le fichier annonce ${nf.format(km.km)} km.`,
          immat: km.immat,
        });
      }
      if (computed < 0) {
        anomalies.push({
          id: `km-negatif:${km.immat}`,
          code: 'km-incoherent',
          severity: 'critique',
          title: `${formatImmat(km.immat)} : compteur d'arrivée inférieur au compteur de départ`,
          detail: `${nf.format(km.kmStart)} → ${nf.format(km.kmEnd)}. Le relevé est probablement inversé ou erroné.`,
          immat: km.immat,
        });
      }
    }
  }

  const order = { critique: 0, avertissement: 1, info: 2 };
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title, 'fr'));
}

/**
 * Cherche, parmi les pleins affectes a d'autres vehicules, ceux dont le compteur
 * saisi tombe dans la plage kilometrique du vehicule cible.
 */
function findOdometerMatches(
  output: EngineOutput,
  targetImmat: string,
  settings: Settings,
): Array<{ immat: string; ids: string[]; confidence: number }> {
  const target = output.kmByImmat.get(targetImmat);
  if (!target || target.kmStart == null || target.kmEnd == null) return [];

  const grouped = new Map<string, { ids: string[]; confidence: number }>();
  for (const tx of output.resolved) {
    if (tx.family !== 'gazole' || tx.odometer == null || tx.odometer <= 0) continue;
    if (!tx.assignedImmat || tx.assignedImmat === targetImmat) continue;

    const score = odometerScore(target, tx.odometer, tx.date, settings.odometerTolerance);
    if (score <= 0) continue;

    // Le compteur colle-t-il deja au vehicule actuellement credite ? Si oui, pas de conflit.
    const own = output.kmByImmat.get(tx.assignedImmat);
    if (own && odometerScore(own, tx.odometer, tx.date, settings.odometerTolerance) > 0) continue;

    const entry = grouped.get(tx.assignedImmat) ?? { ids: [], confidence: 0 };
    entry.ids.push(tx.id);
    entry.confidence = Math.max(entry.confidence, score);
    grouped.set(tx.assignedImmat, entry);
  }

  return [...grouped.entries()]
    .map(([immat, e]) => ({ immat, ids: e.ids, confidence: e.confidence }))
    .filter((e) => e.ids.length >= 2 || e.confidence > 0.7)
    .sort((a, b) => b.ids.length - a.ids.length);
}

/** Compte les anomalies par gravite, pour l'affichage en en-tete. */
export function countBySeverity(anomalies: Anomaly[]) {
  return {
    critique: anomalies.filter((a) => a.severity === 'critique').length,
    avertissement: anomalies.filter((a) => a.severity === 'avertissement').length,
    info: anomalies.filter((a) => a.severity === 'info').length,
  };
}

export { formatDate };
