# 🔎 Citation Tracker — CCIAMP

Suit si **cciamp.com** est cité par les assistants IA (ChatGPT, Perplexity,
Gemini...) sur un pool de requêtes que tu définis — **sans aucune clé API,
sans compte à créer côté LLM, sans rien à renouveler.**

## Ce que ça fait

- Tu poses tes requêtes toi-même dans l'interface gratuite du LLM de ton
  choix (ChatGPT, Perplexity, Gemini...), tu colles la réponse dans
  l'outil (2 clics, voir plus bas).
- Le reste est automatique : l'outil historise (`history.json`), détecte
  si cciamp.com apparaît dans le texte, et régénère seul un **dashboard
  visuel** (`docs/index.html`) : courbe de tendance, score, streak, badges 🏆.
- Le dashboard reste accessible en ligne en permanence (GitHub Pages), pas
  besoin de rouvrir l'outil pour le consulter.

**Coût : 0 €. Rien à renouveler** (pas de clé API, pas de quota à
surveiller). C'est le compromis le plus simple à maintenir dans la durée :
la seule "tâche" qui reste manuelle, c'est le copier-coller de la réponse
du LLM — tout le reste (mise en forme, historique, tendances) est automatique.

> Une option "auto" (interrogation automatique de Gemini via une clé API
> gratuite) existe et reste disponible dans le projet si tu changes d'avis
> un jour — voir la section "Pour aller plus loin" en bas de ce fichier.

---

## Installation (à faire une seule fois, ~5 minutes)

1. **Créer un dépôt GitHub** (public ou privé) et y déposer tout ce dossier.

2. *(Optionnel, pour être notifié automatiquement)* :
   va sur https://ntfy.sh, choisis un nom de "topic" unique (ex:
   `cciamp-citations-alex-8k2`), ajoute-le en secret du dépôt sous le nom
   `NTFY_TOPIC` (*Settings → Secrets and variables → Actions*). Installe
   l'appli gratuite ntfy sur ton téléphone en t'abonnant à ce topic : tu
   reçois une notif push à chaque passage. Zéro compte à créer.

3. **Activer GitHub Pages** : *Settings* → *Pages* → Source = branche
   `main`, dossier `/docs`. Ton dashboard sera visible en ligne à une URL
   du type `https://<ton-compte>.github.io/<ton-repo>/`.

C'est fait — pas de clé API à gérer.

---

## Utilisation au quotidien

À la fréquence que tu veux (hebdo, mensuel...), en 2 minutes :

1. Pose une des questions de `queries.yaml` dans ChatGPT, Perplexity ou
   Gemini (version gratuite, dans ton navigateur, comme d'habitude).
2. Copie la réponse complète du LLM.
3. Sur GitHub : onglet *Actions* → "Suivi citations IA" → *Run workflow* →
   mode `manual` → renseigne les 4 champs (LLM, nom de la requête, question
   posée, réponse collée) → *Run workflow*.
4. Recommence pour chaque requête que tu veux tester ce jour-là.
5. Ouvre ton dashboard (l'adresse de l'étape 3 ci-dessus) : tout est déjà
   mis à jour.

Tu veux changer les requêtes suivies ? Édite `queries.yaml` directement sur
GitHub (bouton crayon ✏️ en haut à droite du fichier), sauvegarde — c'est
pris en compte dès ton prochain passage manuel.

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `queries.yaml` | Le pool de requêtes à suivre — à personnaliser |
| `scripts/check_citations.py` | Le script qui interroge Gemini, analyse, historise, génère le dashboard |
| `.github/workflows/track-citations.yml` | L'automatisation (planification + déclenchement manuel) |
| `history.json` | L'historique brut de tous les passages |
| `docs/index.html` | Le dashboard généré (à publier via GitHub Pages) |

## Partager avec tes collègues (une seule page pour tout faire)

Une petite application gratuite (hébergée sur Vercel) donne à toi et tes
collègues **une seule adresse internet** qui affiche le dashboard **et**
un formulaire d'ajout, sans Google Form, sans compte GitHub à créer pour
tes collègues.

**Installation (~10 minutes, une seule fois) :**

1. Rends le dépôt public (*Settings → Danger Zone → Change visibility →
   Public*) — nécessaire pour que la page puisse lire `history.json`
   librement.
2. Ouvre `webapp/index.html` et remplace, tout en haut du `<script>`, les
   deux lignes :
   ```
   const OWNER = "REMPLACE_PAR_TON_PSEUDO_GITHUB";
   const REPO = "REMPLACE_PAR_TON_NOM_DE_DEPOT";
   ```
   par ton vrai pseudo GitHub et le nom réel de ton dépôt. Enregistre et
   dépose ce fichier modifié sur GitHub (comme les autres, via "Add file →
   Upload files" si tu préfères tout faire depuis le site web).
3. Crée un token GitHub (nécessaire pour que la page puisse enregistrer
   les nouveaux tests) : sur github.com → ta photo de profil → *Settings*
   → tout en bas, *Developer settings* → *Personal access tokens* →
   *Tokens (classic)* → *Generate new token* → coche la case `repo` →
   choisis une expiration (1 an conseillé) → génère, et copie le token
   affiché (il ne sera plus jamais réaffiché ensuite).
4. Crée un compte gratuit sur https://vercel.com — clique "Continue with
   GitHub" pour te connecter directement avec ton compte GitHub existant
   (aucun nouveau mot de passe à retenir).
5. Sur Vercel : *Add New → Project* → choisis ton dépôt GitHub. Dans les
   réglages avant de déployer, ouvre *"Root Directory"* et sélectionne le
   dossier `webapp`.
6. Toujours dans les réglages avant de déployer, section *Environment
   Variables*, ajoute ces 3 variables :
   - `GITHUB_TOKEN` → le token copié à l'étape 3
   - `GITHUB_OWNER` → ton pseudo GitHub
   - `GITHUB_REPO` → le nom de ton dépôt
7. Clique *Deploy*. Après ~1 minute, Vercel te donne une adresse du type
   `https://ton-projet.vercel.app` — **c'est la seule adresse à partager**
   avec tes collègues, à mettre en favori, à glisser dans Slack/l'intranet.

**Utilisation ensuite :** tout le monde ouvre cette adresse, voit le
dashboard à jour, et peut remplir le petit formulaire en bas de la même
page pour ajouter un test. Aucun compte, aucune interface technique, une
seule page.

> Le `docs/index.html` + GitHub Pages mis en place précédemment devient
> alors inutile (tu peux l'ignorer ou désactiver Pages dans les réglages
> du dépôt) — cette nouvelle page Vercel le remplace avantageusement.

## Limites à garder en tête

- Ce mode "sans clé" demande un peu de ta présence (copier-coller) à chaque
  passage — c'est le prix de la simplicité et de la gratuité totale.
- Comme c'est toi qui choisis quand tester, il n'y a pas de rythme imposé :
  tu peux tester une seule requête un jour donné, ou tout le pool, selon ton
  temps disponible.

## Pour aller plus loin (facultatif, à ignorer si tu es satisfait comme ça)

Le projet contient encore le code du mode `auto` (interrogation automatique
de Gemini, gratuit, avec recherche web). Si un jour tu veux automatiser au
moins un des trois LLM sans y penser chaque semaine :

1. Crée une clé gratuite sur https://aistudio.google.com/app/apikey
2. Ajoute-la en secret du dépôt sous le nom `GEMINI_API_KEY`
3. Dans `.github/workflows/track-citations.yml`, remets un bloc `schedule:`
   (exemple : `- cron: "0 7 * * 1"` pour tous les lundis 7h) au-dessus de
   `workflow_dispatch:`

Tant que tu ne fais pas ça, cette partie du projet est totalement inactive
et sans risque — elle ne coûte rien et ne s'exécute jamais toute seule.
