# Écoute Moteur 🎚️

Application iOS **100 % locale** d'analyse sonore du ralenti moteur. Posez votre
téléphone près du moteur de votre moto ou voiture qui tourne au ralenti :
l'application écoute via le micro, affiche le spectre de fréquence en temps réel,
mémorise un « profil sonore normal » par véhicule, puis signale visuellement
toute fréquence inhabituelle (cliquetis, sifflement, nouvelles harmoniques).

> ⚠️ **Outil indicatif uniquement.** Aide à la détection précoce — ne remplace
> **pas** le diagnostic d'un mécanicien professionnel.

---

## Principes

- **Aucun backend, aucun compte, aucune authentification.** Rien n'est envoyé
  nulle part.
- **Tout le traitement audio est local**, en temps réel, via la **Web Audio API
  native** (`AudioContext` + `AnalyserNode` + `getByteFrequencyData`).
- Les profils (moyennes de spectre) et l'historique sont stockés **en local**
  via `localStorage`. Aucun échantillon audio brut n'est conservé.
- Le micro n'est demandé **qu'après un tap explicite** sur « Démarrer l'écoute »,
  avec gestion propre du refus de permission.
- Bande d'analyse filtrée sur **20 Hz – 2000 Hz** (passe-haut + passe-bas) pour
  écarter le souffle et la parole et se concentrer sur le moteur.

## Écrans

1. **Accueil** — liste des profils véhicules + bouton « Nouveau profil » +
   avertissement visible. Bouton ⓘ « À propos ».
2. **Profil** — résumé (cylindres, ralenti de référence, RPM estimé), réglage de
   la **tolérance** de détection, historique des écoutes, suppression.
3. **Référence** — oscilloscope en direct ; après ≥ 12 s d'écoute, bouton
   « Valider comme normal » qui enregistre la moyenne du spectre.
4. **Diagnostic** — spectre en direct **superposé** à la référence, indicateur
   global vert / jaune / rouge, jauge d'écart, et liste textuelle des anomalies
   (« Fréquence inhabituelle autour de 340 Hz »).

## Structure du projet

```
.
├── capacitor.config.json     # Configuration Capacitor (appId, webDir=www)
├── package.json              # Dépendances Capacitor + scripts
├── www/                      # Application web (le livrable réel)
│   ├── index.html            # Structure des écrans + modales
│   ├── css/styles.css        # Thème sombre « oscilloscope »
│   └── js/
│       ├── storage.js        # Persistance locale (profils + historique)
│       ├── audio.js          # Moteur Web Audio (micro + FFT + band-pass)
│       ├── analysis.js       # Moyennes de spectre, estimation RPM, comparaison
│       ├── visualizer.js     # Rendu canvas du spectre / oscilloscope
│       └── app.js            # Routeur d'écrans + contrôleur UI
└── README.md
```

> Le dossier natif `ios/` n'est **pas** versionné : il est généré localement par
> Capacitor (voir ci-dessous).

---

## Tester l'application web rapidement (navigateur de bureau)

Le micro nécessite un contexte sécurisé (`localhost` est accepté) :

```bash
npm run serve         # sert www/ sur http://localhost:5173
```

> ⚠️ Le micro **ne fonctionne pas correctement dans le simulateur iOS** pour cet
> usage. Testez l'analyse réelle sur un **appareil physique**.

---

## Build iOS via Capacitor (Xcode)

Prérequis : macOS, **Xcode**, **Node.js**, **CocoaPods** (`sudo gem install cocoapods`),
et votre licence développeur Apple.

```bash
# 1. Installer les dépendances
npm install

# 2. Ajouter la plateforme iOS (génère le dossier ios/)
npx cap add ios

# 3. Copier les assets web + synchroniser les plugins
npx cap sync ios

# 4. Ouvrir le projet dans Xcode
npx cap open ios
```

### Étape OBLIGATOIRE — autorisation micro (Info.plist)

iOS exige une description d'usage du micro, sinon l'application plante au moment
de la demande de permission. Dans Xcode, sélectionnez la cible **App**, onglet
**Info**, et ajoutez la clé :

- **Key**: `Privacy - Microphone Usage Description`
  (`NSMicrophoneUsageDescription`)
- **Value**:
  `Le microphone est utilisé localement pour analyser le son du moteur. Aucun enregistrement n'est conservé ni transmis.`

Vous pouvez aussi l'ajouter directement dans `ios/App/App/Info.plist` :

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Le microphone est utilisé localement pour analyser le son du moteur. Aucun enregistrement n'est conservé ni transmis.</string>
```

### Lancer sur appareil

1. Dans Xcode, sélectionnez votre iPhone connecté comme cible.
2. Renseignez votre **Team** de signature (onglet *Signing & Capabilities*).
3. Appuyez sur **Run** ▶︎. Au premier « Démarrer l'écoute », iOS demande
   l'autorisation micro.

### Mettre à jour après une modif web

Après toute modification dans `www/` :

```bash
npx cap copy ios        # ou: npx cap sync ios
```

---

## Notes techniques

- **FFT** : `fftSize = 4096` → résolution ≈ 10–12 Hz/bin selon le taux
  d'échantillonnage du device.
- **Référence** : moyenne par bin du spectre octet (0–255) sur toute la fenêtre
  d'enregistrement, stockée dans le profil.
- **Comparaison** : on ne signale que le contenu **nouveau ou plus fort** que la
  référence (`live − référence > seuil`). Le seuil dépend de la tolérance réglée.
  Le score global (0–100 %) pilote l'indicateur vert / jaune / rouge.
- **RPM estimé** (4 temps) : `RPM ≈ f0 × 120 / cylindres`, où `f0` est la
  fréquence fondamentale détectée. Valeur **indicative**.
- **Confidentialité** : `AnalyserNode` n'est jamais connecté à la sortie audio
  (pas de larsen) ; aucune donnée audio n'est écrite sur le disque ni transmise.

## Licence

Projet privé. Tous droits réservés.
