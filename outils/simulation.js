#!/usr/bin/env node
/* =====================================================================
   HAUTE-TENSION — Simulation d'équilibrage (Node.js)
   Utilise exactement le même moteur et les mêmes bots que le jeu.

   Usage :
     node outils/simulation.js                       (4 joueurs, 5000 parties)
     node outils/simulation.js --joueurs 6 --parties 10000
     node outils/simulation.js --niveau expert
     node outils/simulation.js --config '{"STARTING_GES":45,"TAX_AMOUNT":3}'
     node outils/simulation.js --trace               (déroulé d'une partie)
   ===================================================================== */
'use strict';
const path = require('path');
const DATA = require(path.join(__dirname, '../js/data.js'));
const { Game } = require(path.join(__dirname, '../js/engine.js'));
const { Bot, runBots } = require(path.join(__dirname, '../js/ai.js'));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const nPlayers = +opt('joueurs', 4);
const nGames = +opt('parties', 5000);
const level = opt('niveau', 'normal');
const config = JSON.parse(opt('config', '{}'));
const trace = args.includes('--trace');

function newGame(seed) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({
    name: DATA.DEPARTMENTS[i].name, isBot: true, level,
  }));
  return new Game({ players, config, seed });
}
function playOne(seed, onEvents) {
  const g = newGame(seed);
  const bots = g.players.map(p => new Bot(g, p.id));
  runBots(g, bots, onEvents);
  return g;
}

if (trace) {
  const G = newGame(+opt('graine', 42));
  const name = (id) => G.players[id].name;
  runBots(G, G.players.map(p => new Bot(G, p.id)), (evs) => {
    for (const e of evs) {
      switch (e.type) {
        case 'year_start': console.log(`\n── Année ${e.year} ── GES ${G.ges}`); break;
        case 'draw_job': console.log(`  ${name(e.player)} recrute ${G.def(e.card).name}`); break;
        case 'sell_job': console.log(`  ${name(e.player)} vend ${G.def(e.card).name}`); break;
        case 'trade_accepted': console.log(`  ${name(e.player)} achète ${G.def(e.card).name} à ${name(e.seller)}`); break;
        case 'trade_refused': console.log(`  ${name(e.seller)} refuse de vendre à ${name(e.player)}`); break;
        case 'realize': console.log(`  ▶ ${name(e.player)} réalise ${G.def(e.card).name} (GES ${e.gesBefore}→${e.gesAfter})`); break;
        case 'change_project': console.log(`  ↻ ${name(e.player)} change ${G.def(e.card).name}`); break;
        case 'alea': console.log(`  ⚡ Aléa : ${G.def(e.card).name}`); break;
        case 'eliminated': console.log(`  ✗ ${name(e.player)} est éliminé`); break;
        case 'tax': console.log('  Pièces : ' + G.players.map(p => `${p.name} ${p.alive ? p.coins : '✗'}`).join(' | ')); break;
        case 'game_over': console.log(`\nFIN — GES ${e.ges} : ${e.win ? 'VICTOIRE' : 'défaite'}`); break;
      }
    }
  });
  process.exit(0);
}

let wins = 0, gesSum = 0, elim = 0, gamesWithElim = 0;
const realizedByKey = {};
const gesHist = Array(DATA.CONFIG.YEARS + 1).fill(0);
for (let s = 0; s < nGames; s++) {
  const g = playOne(1000 + s);
  if (g.win) wins++;
  gesSum += g.ges;
  const dead = g.players.filter(p => !p.alive).length;
  elim += dead;
  if (dead) gamesWithElim++;
  g.gesHistory.forEach((v, i) => { gesHist[i] += v; });
  for (const p of g.players) for (const r of p.realized) realizedByKey[r.card.key] = (realizedByKey[r.card.key] || 0) + 1;
}
const pct = x => (100 * x).toFixed(1) + ' %';
console.log('================ RÉSULTATS ================');
console.log(`Joueurs : ${nPlayers}   Parties : ${nGames}   Niveau bots : ${level}`);
console.log(`Taux de victoire            : ${pct(wins / nGames)}`);
console.log(`GES final moyen             : ${(gesSum / nGames).toFixed(1)}  (objectif ≤ ${Object.assign({}, DATA.CONFIG, config).TARGET_GES})`);
console.log(`Joueurs éliminés / partie   : ${(elim / nGames).toFixed(2)}  (${pct(elim / nGames / nPlayers)} des joueurs)`);
console.log(`Parties avec ≥1 élimination : ${pct(gamesWithElim / nGames)}`);
console.log('GES moyen par année         : ' + gesHist.map(v => (v / nGames).toFixed(0)).join(' → '));
console.log('Projets réalisés / partie   :');
for (const [k, v] of Object.entries(realizedByKey).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${DATA.PROJECTS[k].name.padEnd(26)} ${(v / nGames).toFixed(2)}`);
}
