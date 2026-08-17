# DKV Aiguillage

**Aiguiller chaque plein de carburant vers le bon camion.**

Application web qui remplace la consolidation trimestrielle faite jusqu'ici à la main sous Excel :
elle croise le relevé kilométrique des camions avec les exports carburant DKV, calcule la
consommation réelle en L/100 km, met en évidence les anomalies (échanges de cartes, plaques mal
saisies, compteurs incohérents) et produit un fichier Excel propre à transmettre.

Le nom vient du travail réel de l'outil : dans les données brutes, un plein est enregistré sous la
plaque que le chauffeur a saisie — souvent la mauvaise. L'application le renvoie vers le véhicule
qui l'a effectivement consommé, en s'appuyant sur le kilométrage relevé à la pompe.

**Tout se passe dans le navigateur.** Aucun fichier n'est envoyé sur Internet, aucun serveur ne
stocke quoi que ce soit : c'est ce qui permet d'héberger l'outil sur GitHub Pages tout en
manipulant des données d'entreprise.

---

## Utilisation

### 1 · Importer

Deux dépôts de fichiers :

| Fichier | Format | Rôle |
| --- | --- | --- |
| Relevé kilométrique TICPE | `.txt` ou `.csv` | Définit le périmètre des camions, la période et les kilomètres. **Source de vérité pour les km.** |
| Exports carburant DKV | `.xlsx`, `.xls`, `.csv` | Un fichier par mois, ou un classeur multi-onglets. Plusieurs fichiers à la fois. |

Les colonnes sont reconnues **par leur intitulé**, pas par leur position : les exports DKV changent
d'ordre, de nombre de colonnes et de vocabulaire d'un mois à l'autre (`Volume` devient `Quantité`,
etc.) sans que cela pose problème. Si deux exports se recouvrent, les doublons sont écartés.

L'application affiche la période réelle de chaque fichier et **alerte si un export ne couvre pas le
bon trimestre** — l'erreur la plus coûteuse, puisqu'elle fausse tous les totaux sans rien casser
visiblement.

### 2 · Contrôler

La liste des anomalies, classée par gravité :

| Contrôle | Ce qu'il détecte |
| --- | --- |
| **Transactions hors trimestre** | Un export téléchargé pour la mauvaise période. |
| **Camion sans carburant** | Un camion qui a roulé sans qu'aucun plein ne lui soit rattaché — signature d'un échange de carte. |
| **Compteur incohérent** | Un plein dont le kilométrage saisi à la pompe ne correspond pas au camion déclaré, mais tombe dans la plage d'un autre. → réaffectation proposée. |
| **Compteur d'un véhicule inconnu** | Un plein dont le compteur ne correspond à *aucun* camion du relevé : véhicule neuf, de remplacement, ou d'une autre région. → exclusion proposée. |
| **Carte anonyme** | Une carte sans immatriculation lisible (`RELAIS 1`, cellule vide). Le camion est identifié par vote sur les compteurs saisis. |
| **Plein hors période de relevé** | Des pleins au compteur cohérent mais datés en dehors de la fenêtre kilométrique du camion : le relevé km est incomplet. |
| **Consommation aberrante** | Un L/100 km hors de la plage attendue (15–45 par défaut, réglable). |
| **Gazole hors périmètre** | Un véhicule qui consomme sans figurer au relevé kilométrique. |
| **Doublons** | Des lignes présentes dans deux exports. |
| **Incohérence des compteurs** | Km annoncés ≠ écart des compteurs, ou compteur d'arrivée inférieur au départ. |

Les contrôles sont conçus pour ne pas se contredire : un plein dont le compteur désigne un autre
camion relève de la réaffectation, jamais de l'exclusion, et une ligne volontairement exclue n'est
plus resignalée.

Quand la correction est fiable, un bouton l'applique en un clic, avec un indice de confiance.

### 3 · Corriger

Quatre façons d'intervenir, toutes mémorisées :

- **Ligne par ligne** — la colonne *Affecté à* décide à quel camion les litres sont comptés.
  L'application propose le camion le plus probable en comparant le compteur saisi aux plages
  kilométriques connues, interpolées à la date du plein.
- **En masse** — une règle du type « la carte X entre le 10 et le 20 février va sur FL-575-GQ »
  s'applique d'un coup, et se rejoue automatiquement aux imports suivants.
- **Exclusion** — une ligne peut être sortie du calcul sans être supprimée.
- **Totaux** — dans le récapitulatif, les cases *Km* et *Litres* sont modifiables à la main ; la
  valeur saisie remplace le calcul et apparaît en vert, dans l'application comme dans l'export.

### 4 · Exporter

Le classeur Excel contient quatre onglets :

1. **Récapitulatif** — le tableau final, avec totaux, historique des trimestres archivés et mise en
   évidence des valeurs corrigées ou hors plage.
2. **Détail transactions** — chaque plein, avec l'immatriculation saisie, celle retenue et l'origine
   de l'affectation. C'est la pièce justificative.
3. **Anomalies** — la trace de ce qui a été détecté.
4. **Méthode** — les règles de calcul appliquées, pour que le destinataire comprenne les chiffres.

### Référentiel

Région, catégorie (CD/MD/LD), code flotte et rattachement des cartes se saisissent **une seule
fois** : ils sont conservés d'un trimestre à l'autre dans le navigateur, avec les règles et les
corrections. Le bouton *Archiver ce trimestre* fige les consommations pour alimenter les colonnes
d'historique des trimestres suivants.

La configuration s'exporte en JSON pour changer de poste.

---

## Règles de calcul

- **Litres retenus : le gazole uniquement.** AdBlue, essence, péages, parking et frais divers sont
  lus et visibles dans le détail, mais exclus du calcul de consommation.
- **Kilomètres retenus : le relevé TICPE**, ou la valeur saisie à la main si elle existe.
- **Consommation** = litres de gazole ÷ kilomètres × 100.
- **Ordre de rattachement d'un plein** — du plus fiable au moins fiable :
  1. correction manuelle ponctuelle,
  2. règle de correction en masse,
  3. immatriculation lisible et connue,
  4. code flotte (centre de coûts),
  5. numéro de carte carburant.

Les immatriculations sont normalisées avant toute comparaison : `FV-193-CR`, `FV193CR` et
`fv 193 cr` désignent le même camion. Les libellés parasites (`RELAIS 1`, cellules vides) sont
écartés plutôt que traités comme des plaques.

---

## Développement

```bash
npm install     # installer les dépendances
npm run dev     # serveur local, http://localhost:5173
npm test        # 60 tests unitaires, d'intégration et de rendu
npm run build   # génère dist/, prêt à héberger
```

### Organisation

```
src/lib/          logique métier, sans dépendance à l'interface
  normalize.ts      immatriculations, dates, nombres, encodages
  model.ts          types partagés et classification des produits
  parseKm.ts        lecture du relevé kilométrique
  parseDkv.ts       lecture des exports DKV, détection des colonnes
  engine.ts         référentiel, affectation des pleins, suggestions
  anomalies.ts      les contrôles
  exportXlsx.ts     génération du classeur
  storage.ts        persistance navigateur
src/components/   interface React
src/state.ts      état applicatif et enchaînement du traitement
```

La logique métier est testée indépendamment de l'interface. Les tests d'intégration s'exécutent sur
les vrais fichiers s'ils sont présents à la racine, et sont ignorés sinon — ils ne sont pas
versionnés.

---

## Mise en ligne sur GitHub Pages

1. Créer un dépôt GitHub et y pousser ce projet :

   ```bash
   git init
   git add .
   git commit -m "DKV Aiguillage"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/<votre-depot>.git
   git push -u origin main
   ```

2. Dans le dépôt : **Settings → Pages → Source → GitHub Actions**.

3. Le workflow `.github/workflows/deploy.yml` construit et publie le site à chaque push sur `main`.
   L'URL apparaît dans l'onglet *Actions* à la fin du déploiement.

> **Les fichiers de données ne doivent jamais être poussés.** Le `.gitignore` exclut déjà `*.xlsx`,
> `*.xls` et `*.txt` à la racine. Vérifiez avec `git status` avant le premier commit : les exports
> DKV et les relevés kilométriques contiennent des données nominatives et commerciales.

Le site fonctionne aussi hors ligne : `npm run build` puis ouvrir `dist/index.html`.
