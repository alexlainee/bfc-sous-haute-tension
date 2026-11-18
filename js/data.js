/* =====================================================================
   HAUTE-TENSION — Données du jeu
   ---------------------------------------------------------------------
   Ce fichier est le SEUL endroit à modifier pour changer l'équilibrage :
   paramètres de règles, valeurs des cartes, composition des paquets.
   Les valeurs des cartes projet reprennent celles des cartes dessinées.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------- Paramètres de règles (livret) ---------- */
  const CONFIG = {
    YEARS: 10,                 // 10 tours = 10 années
    STARTING_COINS: 20,        // pièces de départ par joueur
    STARTING_JOBS: 3,          // cartes métier en main au départ
    STARTING_PROJECTS: 5,      // cartes projet en main
    STARTING_GES: 40,          // position du jeton GES au départ (u.a.)
    TARGET_GES: 10,            // victoire si GES <= 10 à la fin
    GES_MIN: 0,                // le jeton ne descend pas sous 0
    GES_MAX: 60,               // limite d'affichage de la jauge
    TAX_AMOUNT: 2,             // coût du département à la fin de chaque année
    JOB_DRAW_COST: 1,          // recruter depuis la pioche
    JOB_TRADE_COST: 2,         // acheter à un autre joueur (payé au joueur)
    JOB_SELL_GAIN: 1,          // vendre (défausser) une carte métier
    PROJECT_CHANGE_GAIN: 0,    // changer de projet (0 dans le livret)
    JOB_ACTIONS: 2,            // actions métier par tour
    REFILL_PROJECT_HAND: true, // après une réalisation, on repioche un projet
    ALEAS_ENABLED: true,
  };

  /* ---------- Variantes proposées au lancement d'une partie ----------
     Résultats des simulations (bots « normal », 4 / 5 / 6 joueurs) :
       livret     : ~30 / 47 / 60 % de victoires, 85-90 % de joueurs éliminés
       equilibree : ~95 / 91 / 89 % de victoires, 27-37 % de joueurs éliminés */
  const PRESETS = {
    livret: { label: 'Règles du livret', desc: '20 pièces, taxe de 2, changer de projet ne rapporte rien.', config: {} },
    equilibree: { label: 'Variante équilibrée', desc: 'Taxe de 1 pièce, changer de projet rapporte 1 pièce.', config: { TAX_AMOUNT: 1, PROJECT_CHANGE_GAIN: 1 } },
  };

  /* ---------- Les 4 familles de métiers (couleurs des cartes) ---------- */
  const COLORS = {
    RED:   { label: 'Production & maintenance des infrastructures', short: 'Production', hex: '#c8402a' },
    BLUE:  { label: 'Efficacité & réduction du gaspillage',         short: 'Efficacité', hex: '#3556b8' },
    BROWN: { label: 'Environnement & concertation',                  short: 'Environnement', hex: '#7a4a2c' },
    GREEN: { label: 'Le réseau (anticiper la demande, transporter l’énergie)', short: 'Réseau', hex: '#2f7d3a' },
  };
  const COLOR_ORDER = ['RED', 'BLUE', 'GREEN', 'BROWN'];

  /* ---------- Cartes métier ----------
     copies = nombre d'exemplaires dans la pioche commune.
     Choix : 48 cartes, proportionnelles à la demande des projets
     (rouge demandé par 6 projets, bleu et vert par 4, marron par 2). */
  const JOBS = {
    soudeur: {
      name: 'Soudeur·euse / Chaudronnier·ère', color: 'RED', copies: 8,
      img: 'assets/cartes/metier-soudeur.webp',
      fact: "En nucléaire, les soudeurs·euses passent des certifications ultra-exigeantes, équivalentes à celles de l'aéronautique : ils doivent parfois souder au millimètre près !",
      desc: "L'artisan du métal indispensable à la transition. Il façonne, assemble et répare les pièces métalliques complexes nécessaires à la construction des infrastructures énergétiques (mâts d'éoliennes, tuyauteries de réseaux de chaleur, méthaniseurs). Un métier manuel d'une précision absolue.",
    },
    chef_projet: {
      name: 'Chef·fe de projet renouvelable', color: 'RED', copies: 8,
      img: 'assets/cartes/metier-chef_projet_renouvelable.webp',
      fact: "Ils coordonnent les projets pour réduire les émissions. Plus de 345 000 postes sont attendus d'ici 2035 !",
      desc: "Le véritable chef d'orchestre. Il pilote le développement des nouvelles centrales (parcs éoliens, fermes solaires, etc.) de A à Z. De l'étude de faisabilité à la mise en service, il coordonne les équipes techniques, gère les budgets et veille au respect des délais.",
    },
    inge_efficacite: {
      name: 'Ingénieur·e efficacité énergétique', color: 'BLUE', copies: 6,
      img: 'assets/cartes/metier-inge_eff_ene.webp',
      fact: "Ce sont des alchimistes modernes. Ils transforment les bâtiments énergivores en pros de l'économie d'énergie… C'est pourquoi ce métier est en pleine expansion !",
      desc: "Le traqueur de gaspillage. Il réalise des audits thermiques complexes, analyse les bâtiments ou les industries, et conçoit des plans d'action sur-mesure pour réduire drastiquement leur facture énergétique et leur empreinte carbone.",
    },
    tech_renovation: {
      name: 'Technicien·ne rénovation énergétique', color: 'BLUE', copies: 6,
      img: 'assets/cartes/metier-technicien_renovation.webp',
      fact: "En aidant à passer de l'idée au projet concret, ils sont indispensables pour refaire nos maisons. C'est aussi le métier de la transition qui emploie le plus !",
      desc: "La personne d'action sur le terrain. Il réalise les travaux d'isolation (toitures, murs) et installe des systèmes de chauffage ultra-performants (pompes à chaleur). Il est l'acteur direct de la baisse de la consommation d'énergie dans nos logements.",
    },
    data_analyst: {
      name: 'Data analyst / Dispatcher', color: 'GREEN', copies: 6,
      img: 'assets/cartes/metier-data_analyst.webp',
      fact: "Avec les dispatchers, ce sont les aiguilleurs du réseau électrique : ils équilibrent 24h/24 la production et la consommation d'électricité en France.",
      desc: "Le stratège des flux. Derrière ses écrans, il analyse d'immenses volumes de données en temps réel pour anticiper les besoins et équilibrer l'offre et la demande en électricité. Il est essentiel pour éviter les coupures et optimiser le réseau intelligent.",
    },
    tech_tht: {
      name: 'Technicien·ne lignes très haute tension', color: 'GREEN', copies: 6,
      img: 'assets/cartes/metier-technicien_tht.webp',
      fact: "Ils grimpent à 30 m de haut pour contrôler les réseaux électriques et prévenir les coupures de courant. Un métier d'aventure !",
      desc: "L'acrobate du réseau électrique. Il intervient sur le terrain, souvent en hauteur sur les pylônes, pour installer, entretenir et réparer les câbles qui transportent l'énergie à travers tout le territoire.",
    },
    charge_concertation: {
      name: 'Chargé·e de concertation', color: 'BROWN', copies: 4,
      img: 'assets/cartes/metier-charge_concert.webp',
      fact: "Ce sont les diplomates des projets énergétiques : ils convainquent habitants et territoires de l'importance des infrastructures d'énergie renouvelable.",
      desc: "Le pont entre les projets et les citoyens. Il va à la rencontre des habitants et des élus locaux pour expliquer les futurs projets énergétiques, écouter les craintes, animer des réunions publiques et trouver des compromis acceptables par tous.",
    },
    inge_biodiversite: {
      name: 'Ingénieur·e biodiversité', color: 'BROWN', copies: 4,
      img: 'assets/cartes/metier-inge_biodiversite.webp',
      fact: "Il s'assure que les installations énergétiques ne menacent pas les espèces locales. Un expert des écosystèmes, indispensable à la transition énergétique.",
      desc: "Le protecteur du vivant. Il est le garant de la préservation de la faune et de la flore lors de l'implantation des projets. Il étudie les écosystèmes sur le terrain et impose des règles strictes pour que les infrastructures ne détruisent pas les habitats naturels.",
    },
  };

  /* ---------- Cartes projet (valeurs = cartes dessinées) ----------
     Paquet : 6 exemplaires de chaque projet de transition, 4 de chaque
     projet d'attractivité (52 cartes). Les projets réalisés restant devant
     les joueurs, un paquet plus petit s'épuise à 5-6 joueurs.
     type 'transition' : baisse le GES, coûte des pièces
     type 'attractivite' : rapporte des pièces, augmente le GES
     jobs : couleurs des cartes métier à défausser pour réaliser le projet */
  const PROJECTS = {
    agrivoltaique: {
      name: 'Centrale agrivoltaïque', type: 'transition', cost: 4, gain: 0, ges: -4,
      jobs: ['BLUE', 'GREEN', 'RED'], copies: 6, img: 'assets/cartes/projet-agrivoltaique.webp',
      fact: "Les centrales agrivoltaïques ne sont pas uniquement utiles pour les grandes surfaces, mais aussi pour les jardins !",
    },
    bus_hydrogene: {
      name: 'Bus 100 % hydrogène', type: 'transition', cost: 3, gain: 0, ges: -4,
      jobs: ['BLUE', 'RED'], copies: 6, img: 'assets/cartes/projet-bus-hydr.webp',
      fact: "Ils consomment 65 kWh par kg d'hydrogène produit et offrent une autonomie de 600 km, soit 6 trajets Dijon–Besançon !",
    },
    centrale_nucleaire: {
      name: 'Centrale nucléaire', type: 'transition', cost: 0, gain: 0, ges: -5,
      jobs: ['BLUE', 'GREEN', 'RED'], copies: 6, img: 'assets/cartes/projet-centrale.webp',
      fact: "Une centrale peut fournir 1 600 MW d'électricité, soit 20 % de la consommation de la BFC en 2022.",
    },
    chauffage_urbain: {
      name: 'Chauffage urbain', type: 'transition', cost: 3, gain: 0, ges: -4,
      jobs: ['GREEN', 'RED'], copies: 6, img: 'assets/cartes/projet-chauff_urb.webp',
      fact: "À l'utilisation, les réseaux de chaleur urbains sont les plus économiques : ils peuvent permettre des économies de l'ordre de 100 000 euros.",
    },
    parc_eolien: {
      name: 'Parc éolien', type: 'transition', cost: 3, gain: 0, ges: -4,
      jobs: ['BROWN', 'RED'], copies: 6, img: 'assets/cartes/projet-eolienne.webp',
      fact: "Contrairement aux idées reçues, les éoliennes ne sont pas si bruyantes : seulement 35 dB à 500 m, contre 80 dB pour une voiture à la même distance !",
    },
    renovation: {
      name: 'Rénovation énergétique', type: 'transition', cost: 3, gain: 0, ges: -3,
      jobs: ['GREEN'], copies: 6, img: 'assets/cartes/projet-renov_ener.webp',
      fact: "Pas besoin de faire des rénovations trop coûteuses : de simples rideaux thermiques vous font faire de belles économies.",
    },
    centre_commercial: {
      name: 'Centre commercial', type: 'attractivite', cost: 3, gain: 6, ges: +3,
      jobs: [], copies: 4, img: 'assets/cartes/projet-centre-comm.webp',
      fact: "La clim et l'éclairage sont leur principale source de consommation. Ils sont responsables d'environ 16 % de la consommation électrique.",
    },
    grand_hotel: {
      name: 'Grand Hôtel *****', type: 'attractivite', cost: 0, gain: 6, ges: +2,
      jobs: ['BLUE'], copies: 4, img: 'assets/cartes/projet-grand_hotel.webp',
      fact: "Grand Hôtel La Cloche de Dijon (MGallery) : 216 euros et 17 kg de CO₂ équivalent la nuit, soit 2× plus qu'un hôtel 3*.",
    },
    fast_fashion: {
      name: 'Magasin de fast-fashion', type: 'attractivite', cost: 0, gain: 7, ges: +4,
      jobs: ['BROWN'], copies: 4, img: 'assets/cartes/projet-shein.webp',
      fact: "L'industrie du textile représente 8 % des émissions de gaz à effet de serre, et la fast-fashion aggrave fortement la situation.",
    },
    ski_indoor: {
      name: 'Piste de ski indoor', type: 'attractivite', cost: 0, gain: 10, ges: +6,
      jobs: ['RED'], copies: 4, img: 'assets/cartes/projet-ski-interieur.webp',
      fact: "Aux Pays-Bas, une station de ski intérieure consomme environ 10 GWh par an, dont « seulement » 25 % sont couverts par des panneaux solaires. Ça refroidit !",
    },
  };

  /* ---------- Cartes aléa ----------
     effect : coinsAll (tous les joueurs paient/gagnent), ges (déplace le jeton)
     Une seule carte aléa est dessinée (Tornade) : on la mélange avec des
     cartes « Année calme » pour qu'elle ne tombe pas chaque année.
     Pour ajouter un aléa : ajouter une entrée ici. */
  const ALEAS = {
    tornade: {
      name: 'Tornade', copies: 3, img: 'assets/cartes/alea-tornade.webp',
      effect: { coinsAll: -1 },
      text: 'Tous les joueurs paient une pièce.',
      fact: "En 1982, une tornade d'une violence rare, avec des vents de 220 km/h, ravageait le village de Levier (Doubs). Avec le réchauffement, de tels phénomènes climatiques se produisent de plus en plus.",
    },
    calme: {
      name: 'Année calme', copies: 7, img: null,
      effect: {},
      text: 'Aucun événement cette année.',
      fact: "Pas de catastrophe climatique cette année : profitez-en pour faire avancer vos projets !",
    },
  };

  /* ---------- Départements (positions sur la carte, en %) ---------- */
  const DEPARTMENTS = [
    { id: 'cote_dor', code: '21',      name: "Côte-d'Or",            x: 45.8, y: 40.0 },
    { id: 'doubs', code: '25',         name: 'Doubs',                x: 82.0, y: 50.6 },
    { id: 'saone_loire', code: '71',   name: 'Saône-et-Loire',       x: 41.7, y: 73.0 },
    { id: 'yonne', code: '89',         name: 'Yonne',                x: 15.6, y: 22.4 },
    { id: 'jura', code: '39',          name: 'Jura',                 x: 72.0, y: 68.0 },
    { id: 'nievre', code: '58',        name: 'Nièvre',               x: 13.5, y: 53.0 },
    { id: 'haute_saone', code: '70',   name: 'Haute-Saône',          x: 78.0, y: 33.0 },
    { id: 'belfort', code: '90',       name: 'Territoire de Belfort', x: 92.0, y: 40.0 },
  ];

  /* ---------- Liens ---------- */
  const LINKS = {
    onisep: 'https://q.me-qr.com/q12inh79',  // QR code du livret de règles
    // Lien du questionnaire : remplacer par le lien « Envoyer » de Google Forms
    questionnaire: 'https://docs.google.com/forms/d/1g-Wdo2hgzPJszbR_TtdymHaxkUX9rv-T9lIiRNW915A/viewform',
    contact: 'mailto:jeux.haute.tension@gmail.com',
  };

  const DATA = { CONFIG, PRESETS, COLORS, COLOR_ORDER, JOBS, PROJECTS, ALEAS, DEPARTMENTS, LINKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.HT_DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
