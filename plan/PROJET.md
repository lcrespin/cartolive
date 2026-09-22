# breath.live — Carte de trafic multimodal en temps réel & empreinte carbone

## 1. Pitch du projet

Un site web cartographique affichant en temps réel la position d'un maximum de moyens de transport (trains, avions, bateaux, bus/métro, à terme vélos en libre-service, satellites), avec un angle différenciant : **rendre visible l'empreinte carbone du trafic en direct**, en s'appuyant sur les facteurs d'émission officiels de l'ADEME.

Ce n'est pas un clone de FlightRadar24/MarineTraffic — ces sites n'ont aucune dimension environnementale. L'objectif est d'en faire un outil de sensibilisation basé sur des données réelles et vérifiables, pas moralisateur : les chiffres bruts et sourcés doivent parler d'eux-mêmes.

**Périmètre géographique** : France en priorité (MVP), extension Europe/mondial envisageable ensuite selon les quotas des APIs gratuites.

**Contrainte budgétaire** : quasi nulle. Le projet doit tenir sur des APIs et hébergements gratuits ou très peu coûteux (cible : 15 à 50 € la première année, ~15 €/an ensuite — essentiellement nom de domaine + éventuel petit VPS).

**Principe de scope** : uniquement des **entités mobiles avec position temps réel** (points qui bougent). Pas de données de lieux statiques (bornes de recharge, zones de covoiturage, POI...) — le trafic routier (Bison Futé) est une exception tolérée en tant que calque d'état de réseau, pas un objet traqué individuellement.

---

## 2. Sources de données retenues

| Catégorie | Source | Nature | Accès | Notes |
|---|---|---|---|---|
| Avions | [OpenSky Network](https://opensky-network.org) | Position ponctuelle (ADS-B) | Gratuit, quota par crédits journaliers (~400/jour anonyme, ~8000/jour si contributeur avec récepteur ADS-B). **Auth OAuth2 obligatoire depuis mars 2026** (fini le simple user/password) | Couverture mondiale correcte |
| Bateaux | [AISstream.io](https://aisstream.io) | Position ponctuelle (AIS), WebSocket | Gratuit avec quotas raisonnables en usage non-commercial | Alternative : AISHub (gratuit mais nécessite de contribuer des données via récepteur AIS) |
| Trains | SNCF Open Data ([data.sncf.com](https://data.sncf.com)) + GTFS-RT | Position ponctuelle / horaires | Gratuit | Couverture temps réel partielle (tous les trains n'ont pas de position GPS publique). Eurostar publie aussi un flux GTFS-RT (mise à jour ~30s) |
| Bus / Métro / Tram | **Connecteur GTFS-RT générique** via [transport.data.gouv.fr](https://transport.data.gouv.fr) (le PAN — Point d'Accès National) | Position ponctuelle | Gratuit, très gros volume (centaines de réseaux : RATP/IDFM, TCL Lyon, Tisséo Toulouse, TAN Nantes, Vitalis Poitiers, etc.) | Voir section 3 — brique clé du projet |
| Vélos/trottinettes en libre-service (optionnel) | GBFS (référencé par le PAN) | Position individuelle par véhicule | Gratuit | Vélib', Vélo'v, Lime/Dott/Tier... |
| Satellites | [CelesTrak](https://celestrak.org) (TLE) | Paramètres orbitaux, **pas une position directe** | Gratuit | Nécessite un calcul SGP4 côté client (lib `satellite.js`) — voir section 3 |
| Trafic routier | Bison Futé (diffusion-numerique.info-routiere.gouv.fr) | État de tronçon (fluide/dense/saturé), pas un objet mobile individuel | Gratuit | Mise à jour ~6 min, ~15 grandes agglomérations + réseau national. Calque overlay indépendant, pas un point qui bouge |
| Empreinte carbone | [API Impact CO2](https://impactco2.fr) (ADEME, Base Empreinte®) | Facteurs d'émission (gCO2e/km/passager) par mode | Gratuit, clé d'API sur simple demande | Données peu volatiles → gros cache côté backend |

### Sources explicitement écartées ou à éviter
- **FlightRadar24 API** : payante, plans pro à plusieurs centaines €/mois — hors budget
- **MarineTraffic API** : payante dès un usage réel — hors budget
- Toute donnée de **lieux statiques** (bornes de recharge, zones de covoiturage, zones de livraison) — hors scope voulu par l'utilisateur

---

## 3. Points techniques importants à ne pas oublier

### 3.1 Connecteur GTFS-RT générique (brique prioritaire)
Plutôt que d'écrire un connecteur ad hoc par ville/réseau, écrire **un seul connecteur générique** capable de lire n'importe quel flux GTFS-RT référencé dans le catalogue de transport.data.gouv.fr. Ça permet de couvrir des centaines de réseaux de bus/métro/tram français d'un coup, avec un seul morceau de code à maintenir.

**Point de vigilance perf/budget** : le nombre de flux à poller devient vite important (potentiellement des centaines). Prioriser les plus grandes villes au démarrage (Paris/IDFM, Lyon, Marseille, Toulouse, Bordeaux, Nantes, Lille...), paralléliser intelligemment côté backend (queue + cache par flux avec TTL propre à chaque source).

### 3.2 Satellites — calcul SGP4, pas un simple fetch
CelesTrak ne fournit **pas de position GPS directe** mais des **TLE** (Two-Line Elements — paramètres orbitaux). Le catalogue actif contient environ 15 000 objets, TLE mis à jour toutes les ~2h.

Flux de traitement :
1. Backend récupère les TLE périodiquement (toutes les 2-6h suffit, fichier léger)
2. Le calcul de position réelle se fait via l'algorithme **SGP4**
3. **Faire ce calcul côté navigateur** (lib `satellite.js` en JS), pas côté backend — le backend transmet juste les TLE brutes, chaque client calcule et anime la position en continu localement. Ça évite une charge de calcul serveur inutile et donne une animation fluide sans polling réseau permanent.

**Filtrage nécessaire** : ne jamais afficher les ~15 000 objets d'un coup (illisible + lourd pour le rendu). Prévoir un filtre par groupe (ISS, Starlink, GPS, satellites météo...).

### 3.3 Trafic routier — nature différente des autres flux
Bison Futé donne un **état de tronçon** (fluide/dense/saturé, vitesses moyennes), pas des véhicules individuels trackés. Sur la carte, ça doit se traduire par un **overlay de couleur sur les axes routiers** (vert/orange/rouge), toggle indépendant des autres couches — ne pas essayer de le faire rentrer dans le même modèle de données que les "objets mobiles".

### 3.4 Empreinte carbone — rigueur méthodologique
Les comparaisons CO2 sont sensibles à la méthodologie (trainée de condensation avion / forçage radiatif inclus ou non, taux de remplissage réel vs moyen, well-to-wheel vs combustion seule...). Recommandations :
- Toujours **citer la source** (ADEME / Impact CO2) et la méthodologie sur le site
- Éviter les comparaisons simplistes sans préciser les hypothèses (distance, taux de remplissage)
- Rester factuel, pas moralisateur — ce qui fait la crédibilité de ce type d'outil (Impact CO2 est d'ailleurs cité par des journalistes climat pour cette raison)

### 3.5 OpenSky — changement d'authentification récent
Depuis mars 2026, OpenSky impose une **authentification OAuth2** (fini le simple user/password des versions précédentes de leur API). À vérifier dans leur doc actuelle au moment de l'implémentation, ce point évolue.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (statique)                  │
│   MapLibre GL JS + fond de carte OSM/CARTO            │
│   Couche "objets mobiles" (avions, bateaux, trains,   │
│      bus/métro/vélib) — alimentée par polling backend │
│   Couche "satellites" — TLE transmis, position         │
│      recalculée en continu côté client via satellite.js│
│   Couche "trafic routier" — overlay coloré sur         │
│      tronçons, toggle indépendant                      │
│   Couche "CO2" — popups par véhicule, compteur cumulé, │
│      comparateur multimodal                             │
│   Hébergement : Netlify / Vercel / Cloudflare Pages    │
│      (gratuit)                                          │
└───────────────────────┬───────────────────────────────┘
                         │ WebSocket / fetch périodique
┌───────────────────────▼───────────────────────────────┐
│              BACKEND léger (proxy + cache)              │
│   Node.js (Express/Fastify) ou Python (FastAPI)         │
│   Pollers indépendants par source, chacun avec son      │
│      propre TTL de cache :                               │
│      - OpenSky: ~10-15s                                  │
│      - AISstream: WebSocket, push continu                │
│      - GTFS-RT générique: ~30s par flux, en parallèle/   │
│         queue                                             │
│      - CelesTrak: ~toutes les 2-6h                        │
│      - Bison Futé: ~6 min                                 │
│      - Impact CO2: cache très long (facteurs peu          │
│         volatiles)                                         │
│   API unifiée exposée au frontend (format normalisé      │
│      par type de flux)                                    │
│   Hébergement : Fly.io / Render free tier, ou VPS         │
│      ~3-5 €/mois (ex. Hetzner) si besoin de stabilité      │
└───────────────────────┬───────────────────────────────┘
                         │
     ┌───────────────────┼────────────────────┐
     ▼                    ▼                     ▼
 OpenSky API      AISstream.io (WS)      SNCF/GTFS-RT
 (avions)         (bateaux)              (trains, bus...)
```

### Pourquoi un backend intermédiaire (pas d'appel direct depuis le navigateur) ?
- Cache les credentials (secrets OAuth2, clés API)
- Évite de cramer le quota si plusieurs visiteurs sont simultanés — un seul poller côté serveur, tous les visiteurs partagent le même cache
- Permet de fusionner/normaliser les formats de données (chaque source a un format différent)

---

## 5. Stack technique proposée

| Brique | Choix | Justification |
|---|---|---|
| Carte | **MapLibre GL JS** | Open-source, WebGL natif, performant, pas de dépendance à une clé API payante (contrairement à Mapbox) |
| Fond de carte | Tuiles CARTO dark (`basemaps.cartocdn.com`) ou OSM | Gratuit |
| Backend | **Node.js + Express** ou **Python + FastAPI** | Au choix selon préférence — les deux conviennent pour ce type de proxy/agrégateur |
| Cache | Objet en mémoire au début, **Redis** si le trafic augmente | Pas nécessaire tant que le trafic reste faible |
| Hébergement frontend | **Cloudflare Pages** ou **Netlify** | Gratuit |
| Hébergement backend | **Fly.io** (free tier) ou VPS **Hetzner** (~3-5 €/mois) | Free tier suffisant au démarrage |
| Calcul satellites | **satellite.js** (npm) | Implémentation SGP4 en JS, exécutable côté client |
| Nom de domaine | ~10-15 €/an | Seul poste de coût quasi incompressible |

---

## 6. Mode 3D (globe) — optionnel, phase 2

Un rendu 3D façon "globe" a été envisagé avec **Three.js**, en particulier pour la visualisation des satellites (altitude réelle, inclinaison orbitale — beaucoup plus lisible en 3D qu'en 2D).

### Arbitrage retenu
- **Phase 1 (MVP)** : rester en 2D avec MapLibre GL. Plus rapide à développer, plus pratique pour l'usage quotidien France (zoom précis, clics sur objets, lisibilité des rues) — et surtout, ça concentre l'effort sur le vrai cœur du projet : les flux de données et le calcul CO2.
- **Phase 2 (si le MVP est stable)** : ajouter un **mode "globe" optionnel** en plus de la carte 2D par défaut, avec la librairie **globe.gl** (wrapper haut niveau au-dessus de Three.js/`three-globe`) pour prototyper rapidement.

### Points de vigilance techniques sur le 3D
- `globe.gl` (wrapper) est plus simple à utiliser mais **moins performant** que `three-globe` (la lib de base), surtout au zoom avec beaucoup de points — un FPS drop documenté existe sur ce point (issue GitHub non résolue depuis 2021, mais le principe reste valable : le wrapper paie un coût de perf pour sa simplicité).
- Si les perfs deviennent un problème réel une fois le volume de données connu, migrer vers `three-globe` directement (moins de magie, plus de contrôle).
- Pour l'affichage simultané de milliers d'objets (avions + bateaux + bus + satellites), prévoir dès le départ :
  - **Culling** : n'afficher que ce qui est dans le champ de vue caméra ou au-dessus d'un seuil de zoom
  - **LOD (Level of Detail)** : agréger les points proches en clusters à faible zoom, détail complet seulement en zoomant
- Le globe 3D est spectaculaire à l'échelle mondiale (page d'accueil, mode "exploration") mais **peu pratique pour un usage local précis** — d'où le choix de le garder en mode alternatif plutôt qu'en vue par défaut.

---

## 7. Fonctionnalités CO2 envisagées (par niveau d'ambition)

### Niveau 1 — Simple (MVP)
- Au clic sur un véhicule : afficher son **CO2/km/passager** (facteur fixe par mode, via API Impact CO2)
- Si la distance du trajet est connue (origine → destination, via GTFS pour trains/bus, plan de vol pour OpenSky) : **CO2 total estimé du trajet**
- Comparateur visuel parlant (ex. "ce vol = X kg CO2 = Y repas avec viande")

### Niveau 2 — Différenciant
- **Sélecteur de trajet A → B** : comparer le CO2 émis par chaque mode disponible pour un même trajet (avion vs train vs voiture vs bus)
- **Code couleur par mode** selon l'intensité carbone (vert = train/bus, orange = voiture, rouge = avion court-courrier)
- **Compteur cumulé en direct** : CO2 émis par tous les véhicules actuellement visibles sur la carte, recalculé en continu

### Niveau 3 — Pédagogique/militant (plus poussé, à envisager après validation du reste)
- Highlight des **vols courts ayant une alternative train direct** (< quelques heures)
- **Mode simulation** : slider "et si X% des vols court-courriers passaient au train, combien de CO2 économisé ?"
- Classement/tableau de bord des trajets ou compagnies les plus/moins émetteurs par passager-km — factuel et sourcé, pas moralisateur

---

## 8. État d'avancement à date

### Fait
- Cahier des charges et architecture validés (ce document)
- Choix des sources de données arrêté
- Choix de stack (MapLibre GL, backend Node/Python, hébergements gratuits) arrêté
- **Un prototype HTML autonome fonctionnel** a été réalisé pour valider le rendu visuel :
  - Carte France en thème sombre (MapLibre GL + fond CARTO dark)
  - 4 couches togglables avec compteurs (avions, trains, bateaux, bus) — **données simulées**, pas encore de vrais flux
  - Véhicules simulés se déplaçant en continu entre grandes villes françaises
  - Popup au clic : trajet, distance, passagers estimés, **calcul CO2 avec facteurs ADEME en dur** (à remplacer par un vrai appel à l'API Impact CO2)
  - Comparateur "équivalent en repas avec viande"
  - Compteur cumulé d'émissions en direct, réactif aux couches actives
  - Identité visuelle définie : fond bleu-nuit `#0A0E14`, accent cyan `#3ED9C4` (mouvement/tracking), accent chaleureux `#F2A65A` réservé aux alertes CO2, typographies `Space Grotesk` (titres/chiffres) + `Inter` (texte courant)

Le code complet du prototype est fourni en annexe de ce document (section 10).

### Pas encore fait (prochaines étapes suggérées, par ordre logique)
1. **Backend** : mettre en place le serveur proxy/agrégateur (Node ou Python), commencer par **OpenSky** (avions) car c'est la source la plus simple à brancher
2. Brancher **AISstream** (bateaux) et le **connecteur GTFS-RT générique** (bus/métro/trains)
3. Remplacer les facteurs CO2 en dur par un vrai appel à l'**API Impact CO2**
4. Ajouter le calcul de **distance réelle par trajet** (brique manquante pour un calcul CO2 précis par trajet plutôt qu'un simple facteur/km générique) — à creuser selon les données disponibles par source (plan de vol OpenSky, arrêts GTFS...)
5. Déploiement (frontend sur Cloudflare Pages/Netlify, backend sur Fly.io ou VPS)
6. Satellites (CelesTrak + satellite.js) et trafic routier (Bison Futé) — peuvent venir après un MVP stable sur les 4 modes de transport principaux
7. Mode 3D/globe (phase 2, optionnel)

### Non tranché
- **Nom du site** : pistes évoquées (TrafficLive.fr, FluxLive.fr, LiveGeo.fr...) mais rien d'arrêté — à revoir maintenant que l'angle CO2 est central, un nom évoquant à la fois mouvement ET impact serait plus fort. Le prototype utilise "breath.live" à titre provisoire.

---

## 9. Budget récapitulatif

| Poste | Coût estimé |
|---|---|
| Frontend hosting | 0 € |
| Backend hosting | 0 € (free tier) à 5 €/mois (VPS si besoin de stabilité) |
| Nom de domaine | ~10-15 €/an |
| OpenSky (avions) | 0 € (limité par quota) à ~30 € one-shot (dongle ADS-B pour + de quota) |
| AISstream (bateaux) | 0 € |
| SNCF/GTFS-RT (trains, bus) | 0 € |
| CelesTrak (satellites) | 0 € |
| Bison Futé (trafic routier) | 0 € |
| API Impact CO2 (ADEME) | 0 € |
| **Total 1ère année** | **~15-50 €** |
| **Total années suivantes** | **~15 €/an** |

**Risque de dérapage** : passage à un usage mondial avec forte fréquentation — les quotas gratuits (OpenSky, AISstream) ne suffiraient plus et il faudrait basculer sur des APIs commerciales (centaines d'€/mois). Non pertinent pour un MVP France/Europe à trafic modéré.

---

## 10. Annexe — Code du prototype (référence pour Cursor)

Le fichier `index.html` joint à ce projet est un prototype autonome (une seule page HTML, CSS et JS inline, aucune dépendance de build) qui démontre :
- L'intégration de MapLibre GL avec un style sombre personnalisé
- La structure de couches togglables par type de véhicule
- Le modèle de données simulé (à remplacer par les vrais flux API)
- La logique de calcul et d'affichage CO2 (popups + compteur cumulé)
- L'identité visuelle du projet (tokens couleur/typo à reprendre pour la suite)

**Objectif pour Cursor** : reprendre cette base visuelle et cette structure de couches, puis :
1. Remplacer le générateur de données simulées (`makeVehicle`, `tick()`) par de vrais appels au backend à construire
2. Construire le backend décrit en section 4, en commençant par le connecteur OpenSky
3. Remplacer les `CO2_FACTORS` en dur par un appel à l'API Impact CO2
