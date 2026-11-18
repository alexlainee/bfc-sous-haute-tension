# Haute-Tension — version numérique

Jeu de plateau semi-coopératif sur la transition énergétique en Bourgogne-Franche-Comté, jouable dans un navigateur, de 4 à 6 départements, humains ou IA, sur un seul écran.

## Lancer le jeu

Ouvrir `index.html` dans un navigateur récent (Chrome, Edge, Firefox ou Safari). Aucune installation et aucune connexion internet ne sont nécessaires : tout le jeu (cartes, plateau, polices) est dans ce dossier. Pour le diffuser, il suffit de copier le dossier sur une clé USB ou de le déposer sur n'importe quel hébergement web.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | La page du jeu |
| `js/data.js` | **Toutes les données modifiables** : règles, cartes, paquets, liens |
| `js/engine.js` | Le moteur de règles (indépendant de l'affichage) |
| `js/ai.js` | Les joueurs IA (reprise de l'heuristique du simulateur d'équilibrage) |
| `js/ui.js` | L'interface et le déroulement de la partie |
| `css/style.css` | L'apparence |
| `assets/` | Cartes, plateau, logo et polices |
| `outils/simulation.js` | Simulation d'équilibrage en ligne de commande |

## Modifier le jeu

Tout se fait dans `js/data.js` :

- **Règles** : bloc `CONFIG` (pièces de départ, taxe, GES de départ et objectif, coûts des actions…).
- **Variantes proposées au lancement** : bloc `PRESETS`.
- **Ajouter une carte projet** : copier une entrée de `PROJECTS`, changer ses valeurs et son image (`assets/cartes/`, format portrait 620 × 874 px).
- **Ajouter un métier** : idem dans `JOBS` ; `color` doit être `RED`, `BLUE`, `GREEN` ou `BROWN`.
- **Ajouter une carte aléa** : idem dans `ALEAS`. Effets disponibles : `coinsAll` (pièces gagnées ou perdues par chaque joueur) et `ges` (déplacement du jeton). Une carte sans image s'affiche en violet avec son nom.
- **Nombre d'exemplaires** de chaque carte dans la pioche : champ `copies`.
- **Liens** : bloc `LINKS` (ONISEP, questionnaire, contact). Pour le questionnaire, remplacer le lien par le lien « Envoyer » de Google Forms.

## Équilibrer avec la simulation

Le script utilise exactement le même moteur et les mêmes IA que le jeu. Il faut [Node.js](https://nodejs.org) :

```
node outils/simulation.js                                  # 4 joueurs, 5000 parties
node outils/simulation.js --joueurs 6 --parties 10000
node outils/simulation.js --niveau expert                  # debutant | normal | expert
node outils/simulation.js --config '{"TAX_AMOUNT":1,"PROJECT_CHANGE_GAIN":1}'
node outils/simulation.js --trace                          # déroulé d'une partie
```

Résultats obtenus avec les valeurs des cartes dessinées (IA « normale ») :

| Réglage | 4 joueurs | 6 joueurs |
|---|---|---|
| Règles du livret (20 pièces, taxe 2) | 31 % de victoires, 89 % des joueurs éliminés | 63 % de victoires, 83 % éliminés |
| Variante équilibrée (taxe 1, +1 pièce pour changer de projet) | 95 % de victoires, 27 % éliminés | 90 % de victoires, 37 % éliminés |

## Choix faits pour cette version

- Les valeurs des cartes dessinées font foi (coût, gain, CO₂, métiers requis).
- Le Grand Hôtel demande un métier bleu (efficacité énergétique) : c'est la couleur du carré sur la carte.
- Pioche métiers de 48 cartes : 8 par métier rouge, 6 par métier bleu ou vert, 4 par métier marron (en proportion des besoins des projets).
- Pioche projets de 52 cartes : 6 par projet de transition, 4 par projet d'attractivité.
- Aléas : 3 Tornades mélangées à 7 « Années calmes ».
- Après la réalisation d'un projet, on repioche une carte projet (comme dans le simulateur).
- Une vente entre joueurs peut être refusée ; on ne peut alors plus solliciter ce département pendant le même tour.
- Le jeton GES ne descend pas sous 0.
