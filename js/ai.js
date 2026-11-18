/* =====================================================================
   HAUTE-TENSION — Joueurs virtuels
   ---------------------------------------------------------------------
   Reprise de l'heuristique du simulateur d'équilibrage (simulateurGES) :
     - deux régimes : « collectif » (baisser le GES) et « survie »
       (gagner des pièces quand on risque l'élimination) ;
     - choix des projets par softmax (une part de hasard réglable) ;
     - un tempérament par bot (plus ou moins « vert »).
   Ajouts pour le jeu réel : pioche à paquet, droit de refus des ventes,
   réserve de pièces pour payer la taxe.
   ===================================================================== */
(function (root) {
  'use strict';

  const LEVELS = {
    debutant: { TEMPERATURE: 1.6, W_COLLECTIVE: 1.0, W_SURVIVAL: 1.0, SURVIVAL_RUNWAY: 1.5, label: 'Débutant' },
    normal:   { TEMPERATURE: 0.7, W_COLLECTIVE: 1.5, W_SURVIVAL: 1.0, SURVIVAL_RUNWAY: 2.0, label: 'Normal' },
    expert:   { TEMPERATURE: 0.3, W_COLLECTIVE: 2.0, W_SURVIVAL: 1.2, SURVIVAL_RUNWAY: 2.5, label: 'Expert' },
  };
  const TEMPERAMENT_SPREAD = 0.4;

  function softmaxChoice(items, scores, T, rng) {
    if (!items.length) return null;
    T = Math.max(T, 1e-3);
    const m = Math.max(...scores);
    const w = scores.map(s => Math.exp((s - m) / T));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  class Bot {
    constructor(game, playerId) {
      this.g = game;
      this.id = playerId;
      const p = game.players[playerId];
      this.L = LEVELS[p.level] || LEVELS.normal;
      this.greenBias = game.rng() * TEMPERAMENT_SPREAD;
    }
    get p() { return this.g.players[this.id]; }

    survivalPressure() {
      const runway = this.p.coins / Math.max(this.g.cfg.TAX_AMOUNT, 1);
      return 1 / (1 + Math.max(runway - 1, 0));
    }
    collectivePressure() {
      const c = this.g.cfg;
      if (this.g.ges <= c.TARGET_GES) return 0;
      const remaining = Math.max(c.YEARS + 1 - this.g.year, 1);
      return 1 + (this.g.ges - c.TARGET_GES) / remaining / 4;
    }
    inSurvival() {
      return this.p.coins / Math.max(this.g.cfg.TAX_AMOUNT, 1) < this.L.SURVIVAL_RUNWAY;
    }
    mode() { return this.inSurvival() ? 'survie' : 'collectif'; }

    utility(d) {
      if (this.inSurvival()) {
        const money = (d.gain - d.cost) * this.L.W_SURVIVAL;
        const pen = d.ges > 0 ? 0.2 * d.ges : 0;
        return money - pen;
      }
      return (-d.ges) * (this.L.W_COLLECTIVE * this.collectivePressure() + this.greenBias) - 0.15 * d.cost;
    }

    /** Couleur la plus utile à obtenir, et un joueur qui la possède. */
    wantedColor() {
      const g = this.g, p = this.p;
      let best = null, bestScore = -Infinity;
      for (const pc of p.projects) {
        const d = g.def(pc);
        if (p.coins < d.cost) continue;
        const miss = g.missingColors(p, d);
        if (!miss.length) continue;
        const s = this.utility(d) - 1.5 * miss.length;
        if (s > bestScore) { bestScore = s; best = miss[0]; }
      }
      if (!best) return { color: null };
      const owners = g.players.filter(o => o.alive && o.id !== p.id && !g.refusedBy.has(o.id)
        && o.jobs.some(j => g.jobColor(j) === best));
      // on préfère le joueur qui en a le plus (il refusera moins)
      owners.sort((a, b) => b.jobs.filter(j => g.jobColor(j) === best).length - a.jobs.filter(j => g.jobColor(j) === best).length);
      const target = owners[0] || null;
      const card = target ? target.jobs.find(j => g.jobColor(j) === best) : null;
      return { color: best, target, card };
    }

    /** Couleurs dont le joueur a besoin pour ses meilleurs projets. */
    neededColors() {
      const g = this.g, p = this.p;
      const ranked = p.projects.map(pc => g.def(pc)).sort((a, b) => this.utility(b) - this.utility(a)).slice(0, 2);
      return countColorsOf(ranked.flatMap(d => d.jobs));
    }

    leastUsefulJob() {
      const g = this.g, p = this.p;
      const need = this.neededColors();
      const have = {};
      for (const j of p.jobs) { const c = g.jobColor(j); have[c] = (have[c] || 0) + 1; }
      const surplus = p.jobs.find(j => { const c = g.jobColor(j); return have[c] > (need[c] || 0); });
      return surplus || p.jobs[0];
    }

    /** Décide de la prochaine action du bot lorsqu'il est le joueur actif. */
    decide() {
      const g = this.g, p = this.p, c = g.cfg, rng = g.rng;
      if (g.phase === 'jobs') {
        const surv = this.survivalPressure();
        // vendre quand l'argent manque
        if (p.jobs.length) {
          let sellProb = Math.pow(surv, 1.5);
          if (p.coins < c.TAX_AMOUNT) sellProb = 1;
          if (rng() < sellProb && p.coins < c.TAX_AMOUNT * 2) {
            return { type: 'sell_job', cardUid: this.leastUsefulJob().uid };
          }
        }
        const w = this.wantedColor();
        if (!w.color) return { type: 'end_jobs' };
        const reserve = c.TAX_AMOUNT;  // garder de quoi payer la taxe
        let canBuy = !!w.target && p.coins - c.JOB_TRADE_COST >= reserve && g.can('request_buy', { targetId: w.target.id, cardUid: w.card.uid });
        let canDraw = p.coins - c.JOB_DRAW_COST >= reserve && g.can('draw_job');
        if (canBuy && canDraw) {
          if (rng() < 0.6 * (1 - surv)) canDraw = false; else canBuy = false;
        }
        if (canBuy) return { type: 'request_buy', targetId: w.target.id, cardUid: w.card.uid };
        if (canDraw) return { type: 'draw_job' };
        return { type: 'end_jobs' };
      }
      if (g.phase === 'project') {
        const playable = p.projects.filter(pc => g.projectStatus(p, pc).ok);
        if (playable.length) {
          const items = playable.slice();
          const scores = playable.map(pc => this.utility(g.def(pc)));
          // Ne rien réaliser (changer de projet) a une utilité nulle : un bot
          // en mode collectif évite ainsi de polluer sans nécessité.
          if (!this.inSurvival() && g.can('change_project')) { items.push(null); scores.push(0); }
          const pick = softmaxChoice(items, scores, this.L.TEMPERATURE, rng);
          if (pick) return { type: 'realize', projectUid: pick.uid };
        }
        if (g.can('change_project')) {
          // on change le projet le moins prometteur
          let worst = null, ws = Infinity;
          for (const pc of p.projects) {
            const d = g.def(pc);
            const st = g.projectStatus(p, pc);
            const s = this.utility(d) - 1.5 * st.missing.length - 0.5 * st.lackCoins + rng() * 0.5;
            if (s < ws) { ws = s; worst = pc; }
          }
          return { type: 'change_project', projectUid: worst.uid };
        }
        return { type: 'skip_project' };
      }
      return null;
    }

    /** Réponse à une demande d'achat d'une de ses cartes. */
    respondTrade(pending) {
      const g = this.g;
      const col = g.jobColor(pending.card);
      const need = this.neededColors();
      const have = this.p.jobs.filter(j => g.jobColor(j) === col).length;
      const needed = (need[col] || 0) >= have;
      const surv = this.survivalPressure();
      const pAccept = needed ? (surv > 0.5 ? 0.6 : 0.2) : 0.9;
      return g.rng() < pAccept;
    }
  }

  function countColorsOf(list) {
    const c = {};
    for (const x of list) c[x] = (c[x] || 0) + 1;
    return c;
  }

  /** Fait avancer la partie tant que c'est à un bot de jouer (mode simulation). */
  function runBots(game, bots, onEvents) {
    let guard = 0;
    while (!game.over && guard++ < 100000) {
      if (game.pending) {
        const seller = game.players[game.pending.seller];
        if (!seller.isBot) return;
        const ev = game.act({ type: 'respond_trade', accept: bots[seller.id].respondTrade(game.pending) });
        if (onEvents) onEvents(ev);
        continue;
      }
      const cur = game.current();
      if (!cur.isBot) return;
      const a = bots[cur.id].decide();
      const ev = game.act(a);
      if (onEvents) onEvents(ev);
      if (ev.length && ev[0].type === 'illegal') {
        // sécurité : ne jamais boucler sur une action refusée
        game.act({ type: game.phase === 'jobs' ? 'end_jobs' : 'skip_project' });
      }
    }
  }

  const AI = { Bot, LEVELS, runBots, softmaxChoice };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  else root.HT_AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
