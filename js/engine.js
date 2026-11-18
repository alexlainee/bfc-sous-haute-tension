/* =====================================================================
   HAUTE-TENSION — Moteur de règles
   ---------------------------------------------------------------------
   Indépendant de l'affichage : fonctionne dans le navigateur et sous Node
   (pour les simulations d'équilibrage, voir outils/simulation.js).

   Déroulement d'une année (livret de règles) :
     pour chaque joueur encore en jeu, dans l'ordre :
        2 actions métier   (recruter / acheter à un joueur / vendre)
        1 action projet    (réaliser / changer de projet)
     puis : on retourne une carte aléa et on applique son effet
     puis : chaque joueur paie la taxe ; s'il ne peut pas, il est éliminé
   Victoire collective si, après 10 années, le jeton GES est <= objectif.
   ===================================================================== */
(function (root) {
  'use strict';
  const DATA = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.HT_DATA;

  /* ---------- Hasard reproductible ---------- */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function countColors(list) {
    const c = {};
    for (const col of list) c[col] = (c[col] || 0) + 1;
    return c;
  }

  class Game {
    /**
     * @param {object} opts
     *   players: [{ name, dept, isBot, level }]
     *   config:  surcharge partielle de DATA.CONFIG
     *   data:    surcharge des cartes (JOBS / PROJECTS / ALEAS)
     *   seed:    graine du hasard
     */
    constructor(opts) {
      this.data = Object.assign({}, DATA, opts.data || {});
      this.cfg = Object.assign({}, DATA.CONFIG, opts.config || {});
      this.seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
      this.rng = makeRng(this.seed);
      this._uid = 0;

      this.jobDeck = this._buildDeck('job', this.data.JOBS);
      this.jobDiscard = [];
      this.projectDeck = this._buildDeck('project', this.data.PROJECTS);
      this.projectDiscard = [];
      this.aleaDeck = this._buildDeck('alea', this.data.ALEAS);
      this.aleaDiscard = [];

      this.players = opts.players.map((p, i) => ({
        id: i,
        name: p.name || ('Joueur ' + (i + 1)),
        dept: p.dept || null,
        isBot: !!p.isBot,
        level: p.level || 'normal',
        coins: this.cfg.STARTING_COINS,
        alive: true,
        eliminatedYear: null,
        jobs: [],
        projects: [],
        realized: [],
        stats: { gesDelta: 0, coinsEarned: 0, jobsBought: 0, jobsDrawn: 0, jobsSold: 0, changes: 0 },
      }));
      for (const p of this.players) {
        for (let k = 0; k < this.cfg.STARTING_JOBS; k++) { const c = this._drawJob(); if (c) p.jobs.push(c); }
        for (let k = 0; k < this.cfg.STARTING_PROJECTS; k++) { const c = this._drawProject(); if (c) p.projects.push(c); }
      }

      this.ges = this.cfg.STARTING_GES;
      this.year = 1;
      this.gesHistory = [this.ges];          // GES au début, puis à la fin de chaque année
      this.jobUsage = {};                    // clé métier -> nb de fois utilisé dans un projet
      this.log = [];
      this.over = false;
      this.win = false;
      this.lastAlea = null;
      this._startTurn(this._firstAliveFrom(0));
    }

    /* ================= Paquets ================= */
    _buildDeck(kind, defs) {
      const deck = [];
      for (const key of Object.keys(defs)) {
        const n = defs[key].copies != null ? defs[key].copies : 1;
        for (let i = 0; i < n; i++) deck.push({ uid: ++this._uid, kind, key });
      }
      return shuffle(deck, this.rng);
    }
    _drawFrom(deckName, discardName) {
      if (this[deckName].length === 0 && this[discardName].length > 0) {
        this[deckName] = shuffle(this[discardName], this.rng);
        this[discardName] = [];
      }
      return this[deckName].pop() || null;
    }
    _drawJob() { return this._drawFrom('jobDeck', 'jobDiscard'); }
    _drawProject() { return this._drawFrom('projectDeck', 'projectDiscard'); }
    _drawAlea() { return this._drawFrom('aleaDeck', 'aleaDiscard'); }
    jobsAvailable() { return this.jobDeck.length + this.jobDiscard.length; }

    /* ================= Accès ================= */
    def(card) {
      if (!card) return null;
      if (card.kind === 'job') return this.data.JOBS[card.key];
      if (card.kind === 'project') return this.data.PROJECTS[card.key];
      return this.data.ALEAS[card.key];
    }
    jobColor(card) { return this.data.JOBS[card.key].color; }
    current() { return this.players[this.turnPlayer]; }
    alivePlayers() { return this.players.filter(p => p.alive); }
    _firstAliveFrom(i) {
      const n = this.players.length;
      for (let k = 0; k < n; k++) { const j = (i + k) % n; if (this.players[j].alive) return j; }
      return -1;
    }

    /** Couleurs manquantes pour un projet, compte tenu des métiers du joueur. */
    missingColors(player, projDef) {
      const have = countColors(player.jobs.map(c => this.jobColor(c)));
      const missing = [];
      for (const col of projDef.jobs) {
        if (have[col] > 0) have[col]--; else missing.push(col);
      }
      return missing;
    }
    /** Statut d'un projet en main : réalisable ou non, et pourquoi. */
    projectStatus(player, projCard) {
      const d = this.def(projCard);
      const missing = this.missingColors(player, d);
      const lackCoins = Math.max(0, d.cost - player.coins);
      return { ok: missing.length === 0 && lackCoins === 0, missing, lackCoins };
    }

    /* ================= Tour ================= */
    _startTurn(idx) {
      this.turnPlayer = idx;
      this.phase = 'jobs';                       // 'jobs' -> 'project' -> (joueur suivant)
      this.jobActionsLeft = this.cfg.JOB_ACTIONS;
      this.refusedBy = new Set();                // vendeurs ayant refusé ce tour-ci
      this.pending = null;                       // demande d'achat en attente
    }

    /** Liste des actions possibles pour le joueur actif (utile pour l'UI et les bots). */
    can(type, arg) {
      if (this.over || this.pending) return type === 'respond_trade' && !!this.pending;
      const p = this.current();
      const c = this.cfg;
      switch (type) {
        case 'draw_job':
          return this.phase === 'jobs' && p.coins >= c.JOB_DRAW_COST && this.jobsAvailable() > 0;
        case 'sell_job':
          return this.phase === 'jobs' && p.jobs.length > 0 && (!arg || p.jobs.some(j => j.uid === arg.cardUid));
        case 'request_buy': {
          if (this.phase !== 'jobs' || p.coins < c.JOB_TRADE_COST) return false;
          if (!arg) return this.players.some(o => o.alive && o.id !== p.id && o.jobs.length && !this.refusedBy.has(o.id));
          const s = this.players[arg.targetId];
          return !!s && s.alive && s.id !== p.id && !this.refusedBy.has(s.id) && s.jobs.some(j => j.uid === arg.cardUid);
        }
        case 'end_jobs': return this.phase === 'jobs';
        case 'realize': {
          if (this.phase !== 'project') return false;
          if (!arg) return p.projects.some(pc => this.projectStatus(p, pc).ok);
          const pc = p.projects.find(x => x.uid === arg.projectUid);
          return !!pc && this.projectStatus(p, pc).ok;
        }
        case 'change_project':
          return this.phase === 'project' && p.projects.length > 0 && (this.projectDeck.length + this.projectDiscard.length) > 0;
        case 'skip_project': return this.phase === 'project';
      }
      return false;
    }

    /**
     * Applique une action. Renvoie la liste d'événements produits
     * (utilisée par l'interface pour le journal et les animations).
     */
    act(action) {
      const ev = [];
      if (this.over) return ev;
      if (!this.can(action.type, action)) {
        ev.push({ type: 'illegal', action });
        return ev;
      }
      const p = this.current();
      const c = this.cfg;

      switch (action.type) {
        case 'draw_job': {
          const card = this._drawJob();
          p.coins -= c.JOB_DRAW_COST;
          p.jobs.push(card);
          p.stats.jobsDrawn++;
          ev.push({ type: 'draw_job', player: p.id, card, cost: c.JOB_DRAW_COST });
          this._useJobAction(ev);
          break;
        }
        case 'sell_job': {
          const i = p.jobs.findIndex(j => j.uid === action.cardUid);
          const [card] = p.jobs.splice(i, 1);
          this.jobDiscard.push(card);
          p.coins += c.JOB_SELL_GAIN;
          p.stats.jobsSold++;
          ev.push({ type: 'sell_job', player: p.id, card, gain: c.JOB_SELL_GAIN });
          this._useJobAction(ev);
          break;
        }
        case 'request_buy': {
          const s = this.players[action.targetId];
          const card = s.jobs.find(j => j.uid === action.cardUid);
          this.pending = { buyer: p.id, seller: s.id, card, price: c.JOB_TRADE_COST };
          ev.push({ type: 'trade_request', player: p.id, seller: s.id, card, price: c.JOB_TRADE_COST });
          break;
        }
        case 'respond_trade': {
          const t = this.pending;
          this.pending = null;
          const buyer = this.players[t.buyer], seller = this.players[t.seller];
          if (action.accept) {
            const i = seller.jobs.findIndex(j => j.uid === t.card.uid);
            const [card] = seller.jobs.splice(i, 1);
            buyer.jobs.push(card);
            buyer.coins -= t.price;
            seller.coins += t.price;
            buyer.stats.jobsBought++;
            ev.push({ type: 'trade_accepted', player: buyer.id, seller: seller.id, card, price: t.price });
            this._useJobAction(ev);
          } else {
            this.refusedBy.add(seller.id);
            ev.push({ type: 'trade_refused', player: buyer.id, seller: seller.id, card: t.card });
          }
          break;
        }
        case 'end_jobs': {
          this.jobActionsLeft = 0;
          this.phase = 'project';
          ev.push({ type: 'end_jobs', player: p.id });
          break;
        }
        case 'realize': {
          const i = p.projects.findIndex(x => x.uid === action.projectUid);
          const [proj] = p.projects.splice(i, 1);
          const d = this.def(proj);
          // défausse des métiers requis
          const used = [];
          for (const col of d.jobs) {
            const k = p.jobs.findIndex(j => this.jobColor(j) === col);
            const [jc] = p.jobs.splice(k, 1);
            used.push(jc);
            this.jobDiscard.push(jc);
            this.jobUsage[jc.key] = (this.jobUsage[jc.key] || 0) + 1;
          }
          p.coins += d.gain - d.cost;
          const before = this.ges;
          this.ges = Math.max(c.GES_MIN, this.ges + d.ges);
          p.realized.push({ card: proj, year: this.year, gesDelta: this.ges - before });
          p.stats.gesDelta += this.ges - before;
          p.stats.coinsEarned += d.gain;
          ev.push({ type: 'realize', player: p.id, card: proj, used, cost: d.cost, gain: d.gain, gesBefore: before, gesAfter: this.ges });
          if (c.REFILL_PROJECT_HAND) {
            const n = this._drawProject();
            if (n) { p.projects.push(n); ev.push({ type: 'draw_project', player: p.id, card: n }); }
          }
          this._endTurn(ev);
          break;
        }
        case 'change_project': {
          const i = p.projects.findIndex(x => x.uid === action.projectUid);
          const [old] = p.projects.splice(i, 1);
          const n = this._drawProject();
          this.projectDiscard.push(old);
          if (n) p.projects.push(n);
          p.coins += c.PROJECT_CHANGE_GAIN;
          p.stats.changes++;
          ev.push({ type: 'change_project', player: p.id, card: old, newCard: n, gain: c.PROJECT_CHANGE_GAIN });
          this._endTurn(ev);
          break;
        }
        case 'skip_project': {
          ev.push({ type: 'skip_project', player: p.id });
          this._endTurn(ev);
          break;
        }
      }
      for (const e of ev) { e.year = e.year || this.year; this.log.push(e); }
      return ev;
    }

    _useJobAction(ev) {
      this.jobActionsLeft--;
      if (this.jobActionsLeft <= 0) {
        this.phase = 'project';
        ev.push({ type: 'phase_project', player: this.turnPlayer });
      }
    }

    _endTurn(ev) {
      ev.push({ type: 'turn_end', player: this.turnPlayer });
      // joueur suivant dans l'année ?
      for (let j = this.turnPlayer + 1; j < this.players.length; j++) {
        if (this.players[j].alive) { this._startTurn(j); ev.push({ type: 'turn_start', player: j }); return; }
      }
      this._endYear(ev);
    }

    _endYear(ev) {
      const c = this.cfg;
      ev.push({ type: 'year_end', year: this.year });

      // 1) carte aléa
      if (c.ALEAS_ENABLED) {
        const card = this._drawAlea();
        if (card) {
          this.aleaDiscard.push(card);
          const d = this.def(card);
          const fx = d.effect || {};
          const changes = [];
          if (fx.coinsAll) {
            for (const p of this.alivePlayers()) {
              const before = p.coins;
              p.coins = Math.max(0, p.coins + fx.coinsAll);
              changes.push({ player: p.id, delta: p.coins - before });
            }
          }
          if (fx.ges) this.ges = Math.max(c.GES_MIN, this.ges + fx.ges);
          this.lastAlea = card;
          ev.push({ type: 'alea', card, changes, ges: this.ges });
        }
      }

      // 2) taxe de fin d'année
      const taxes = [];
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.coins < c.TAX_AMOUNT) {
          taxes.push({ player: p.id, paid: false });
          this._eliminate(p, ev);
        } else {
          p.coins -= c.TAX_AMOUNT;
          taxes.push({ player: p.id, paid: true, amount: c.TAX_AMOUNT });
        }
      }
      ev.push({ type: 'tax', taxes });

      this.gesHistory.push(this.ges);

      // 3) fin de partie ?
      if (this.alivePlayers().length === 0 || this.year >= c.YEARS) {
        this._finish(ev);
        return;
      }
      this.year++;
      ev.push({ type: 'year_start', year: this.year });
      this._startTurn(this._firstAliveFrom(0));
      ev.push({ type: 'turn_start', player: this.turnPlayer });
    }

    _eliminate(p, ev) {
      p.alive = false;
      p.eliminatedYear = this.year;
      const n = this.players.length;
      const find = (dir) => {
        for (let k = 1; k < n; k++) {
          const j = ((p.id + dir * k) % n + n) % n;
          if (this.players[j].alive) return this.players[j];
        }
        return null;
      };
      const left = find(-1), right = find(+1);
      const heirs = [left, right].filter((x, i, a) => x && a.indexOf(x) === i);
      const given = [];
      p.jobs.forEach((card, i) => {
        if (heirs.length) {
          const h = heirs[i % heirs.length];
          h.jobs.push(card);
          given.push({ to: h.id, card });
        } else this.jobDiscard.push(card);
      });
      p.jobs = [];
      for (const pc of p.projects) this.projectDiscard.push(pc);
      p.projects = [];
      p.coins = 0;
      ev.push({ type: 'eliminated', player: p.id, heirs: heirs.map(h => h.id), given });
    }

    _finish(ev) {
      this.over = true;
      this.win = this.ges <= this.cfg.TARGET_GES && this.alivePlayers().length > 0;
      this.phase = 'over';
      ev.push({ type: 'game_over', win: this.win, ges: this.ges });
    }
  }

  const ENGINE = { Game, makeRng, shuffle, countColors };
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
  else root.HT_ENGINE = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
