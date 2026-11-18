/* =====================================================================
   HAUTE-TENSION — Interface et déroulement de la partie
   ---------------------------------------------------------------------
   Lit l'état du moteur (engine.js), l'affiche, transmet les actions des
   joueurs humains et fait jouer les bots (ai.js) pas à pas.
   ===================================================================== */
(function () {
  'use strict';
  const D = window.HT_DATA, E = window.HT_ENGINE, AI = window.HT_AI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  };
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED = { slow: 1500, normal: 850, fast: 320 };            // pause entre deux actions d'IA (ms)
  const TIMING = { spotHuman: 7000, spotBot: { slow: 6000, normal: 4200, fast: 2200 }, demoYearEnd: 2600 };
  const GAUGE_MAX = 50;
  const LEVEL_LABEL = { debutant: 'IA débutante', normal: 'IA', expert: 'IA experte' };

  const S = {
    game: null, bots: [], gen: 0, speed: 'normal', humans: 0,
    viewer: null, sellMode: false, busy: false, advancing: false,
    lastSetup: null, lastGes: null, gesDir: '',
  };

  /* ===================================================================
     Petits outils
     =================================================================== */
  function sleep(ms) {
    const gen = S.gen;
    return new Promise(res => setTimeout(() => res(gen === S.gen), ms));
  }
  function pname(id) { return S.game.players[id].name; }
  function deptOf(p) { return D.DEPARTMENTS.find(d => d.id === p.dept) || null; }
  function jobDef(card) { return D.JOBS[card.key]; }
  function projDef(card) { return D.PROJECTS[card.key]; }
  function colorSq(col) { return `<i class="sq" style="background:${D.COLORS[col].hex}" title="${esc(D.COLORS[col].short)}"></i>`; }
  function coins(n) { return `<span class="nw">${n}<span class="coin-dot" aria-hidden="true"></span></span>`; }
  function plural(n, s, p) { return n + ' ' + (n > 1 ? (p || s + 's') : s); }
  function rectOf(sel) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? r : null;
  }
  function cfg() { return S.game.cfg; }

  /* ---------- toasts ---------- */
  function toast(text, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  /* ---------- carte volante ---------- */
  function fly(from, to, img, w = 64) {
    return new Promise(res => {
      if (!from || !to || reducedMotion()) return res();
      const h = w * 874 / 620;
      const el = document.createElement('div');
      el.className = 'fly';
      el.style.backgroundImage = `url("${img}")`;
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.left = (from.left + from.width / 2 - w / 2) + 'px';
      el.style.top = (from.top + from.height / 2 - h / 2) + 'px';
      $('#fly-layer').appendChild(el);
      el.getBoundingClientRect();
      el.style.left = (to.left + to.width / 2 - w / 2) + 'px';
      el.style.top = (to.top + to.height / 2 - h / 2) + 'px';
      setTimeout(() => { el.style.opacity = '0'; }, 560);
      setTimeout(() => { el.remove(); res(); }, 800);
    });
  }

  /* ---------- modale ---------- */
  let modalResolve = null;
  function openModal(html, opts = {}) {
    closePopover();
    const box = $('#modal-box');
    box.innerHTML = html;
    box.style.maxWidth = opts.wide ? '980px' : '';
    $('#modal').hidden = false;
    $('#modal').dataset.dismiss = opts.dismissable === false ? 'no' : 'yes';
    const first = box.querySelector('[data-autofocus]') || box.querySelector('button, a');
    if (first) first.focus({ preventScroll: true });
    box.scrollTop = 0;
    return new Promise(res => { modalResolve = res; });
  }
  function closeModal(value) {
    $('#modal').hidden = true;
    $('#modal-box').innerHTML = '';
    const r = modalResolve; modalResolve = null;
    if (r) r(value);
  }
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal' && $('#modal').dataset.dismiss === 'yes') closeModal(null);
    const b = e.target.closest('[data-value]');
    if (b && !b.disabled) closeModal(b.dataset.value);
  });

  /* ---------- popover (menu contextuel d'une carte) ---------- */
  function openPopover(anchor, title, buttons) {
    const pop = $('#popover');
    pop.innerHTML = `<div class="popover-title">${esc(title)}</div>` + buttons.map((b, i) =>
      `<button class="btn small ${b.primary ? 'tension' : 'ghost'}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>` +
      (b.note ? `<small class="muted">${esc(b.note)}</small>` : '')).join('');
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left + r.width / 2 - pw / 2));
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.onclick = e => {
      const b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      closePopover();
      buttons[+b.dataset.i].run();
    };
    const f = pop.querySelector('button:not(:disabled)'); if (f) f.focus();
  }
  function closePopover() { $('#popover').hidden = true; }
  document.addEventListener('click', e => {
    if (!$('#popover').hidden && !e.target.closest('#popover') && !e.target.closest('[data-pop]')) closePopover();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#popover').hidden) closePopover();
    else if (!$('#modal').hidden && $('#modal').dataset.dismiss === 'yes') closeModal(null);
    else if (S.sellMode) { S.sellMode = false; render(); }
  });

  /* ===================================================================
     Accueil : préparation de la partie
     =================================================================== */
  function seatRow(i, prev) {
    const defDept = D.DEPARTMENTS[i].id;
    const dept = prev ? prev.dept : defDept;
    const type = prev ? prev.type : (i === 0 ? 'human' : 'normal');
    return `<div class="seat" data-seat="${i}">
      <span class="seat-num">${i + 1}</span>
      <select aria-label="Département du joueur ${i + 1}" data-k="dept">
        ${D.DEPARTMENTS.map(d => `<option value="${d.id}" ${d.id === dept ? 'selected' : ''}>${esc(d.name)} (${d.code})</option>`).join('')}
      </select>
      <input aria-label="Nom du joueur ${i + 1}" data-k="name" placeholder="Nom (facultatif)" value="${esc(prev ? prev.name : '')}" maxlength="18">
      <select aria-label="Type de joueur ${i + 1}" data-k="type">
        <option value="human" ${type === 'human' ? 'selected' : ''}>Humain</option>
        <option value="debutant" ${type === 'debutant' ? 'selected' : ''}>IA débutante</option>
        <option value="normal" ${type === 'normal' ? 'selected' : ''}>IA normale</option>
        <option value="expert" ${type === 'expert' ? 'selected' : ''}>IA experte</option>
      </select>
    </div>`;
  }
  function readSeats() {
    return $$('#seats .seat').map(row => ({
      dept: $('[data-k=dept]', row).value,
      name: $('[data-k=name]', row).value.trim(),
      type: $('[data-k=type]', row).value,
    }));
  }
  function renderSeats(n) {
    const prev = readSeats();
    $('#seats').innerHTML = Array.from({ length: n }, (_, i) => seatRow(i, prev[i])).join('');
  }
  function initSetup() {
    renderSeats(4);
    $('#presets').innerHTML = Object.entries(D.PRESETS).map(([k, p], i) => `
      <label class="preset"><input type="radio" name="preset" value="${k}" ${i === 0 ? 'checked' : ''}>
        <span><strong>${esc(p.label)}</strong><small>${esc(p.desc)}</small></span></label>`).join('');
    $('#seg-players').addEventListener('change', e => renderSeats(+e.target.value));
    // départements uniques : si on choisit un département déjà pris, on échange
    $('#seats').addEventListener('change', e => {
      if (e.target.dataset.k !== 'dept') return;
      const me = e.target.closest('.seat');
      const other = $$('#seats .seat').find(r => r !== me && $('[data-k=dept]', r).value === e.target.value);
      if (other) {
        const used = new Set($$('#seats [data-k=dept]').map(s => s.value));
        const free = D.DEPARTMENTS.find(d => !used.has(d.id));
        $('[data-k=dept]', other).value = free ? free.id : e.target.dataset.prev || D.DEPARTMENTS[0].id;
      }
      e.target.dataset.prev = e.target.value;
    });
    $('#setup-form').addEventListener('submit', e => {
      e.preventDefault();
      const setup = {
        seats: readSeats(),
        preset: ($('input[name=preset]:checked') || {}).value || 'livret',
        aleas: $('#opt-aleas').checked,
        speed: ($('input[name=speed]:checked') || {}).value || 'normal',
      };
      startGame(setup);
    });
  }

  /* ===================================================================
     Démarrage
     =================================================================== */
  function startGame(setup) {
    S.gen++;
    S.lastSetup = setup;
    S.speed = setup.speed;
    const players = setup.seats.map(s => {
      const d = D.DEPARTMENTS.find(x => x.id === s.dept);
      return { name: s.name || d.name, dept: s.dept, isBot: s.type !== 'human', level: s.type === 'human' ? null : s.type };
    });
    const config = Object.assign({}, D.PRESETS[setup.preset].config, { ALEAS_ENABLED: setup.aleas });
    S.game = new E.Game({ players, config });
    S.bots = S.game.players.map(p => p.isBot ? new AI.Bot(S.game, p.id) : null);
    S.humans = players.filter(p => !p.isBot).length;
    S.viewer = null; S.sellMode = false; S.busy = false; S.advancing = false;
    S.lastGes = S.game.ges; S.gesDir = '';

    $('#screen-setup').hidden = true; $('#screen-end').hidden = true; $('#screen-game').hidden = false;
    $('#log').innerHTML = '';
    buildGauge();
    logYear(1);
    render();
    const go = () => advance();
    if (!store.get('ht_howto_seen') && S.humans > 0) {
      store.set('ht_howto_seen', '1');
      openHowto().then(go);
    } else go();
  }

  /* ===================================================================
     Rendu
     =================================================================== */
  function trayPlayerId() {
    const g = S.game, cur = g.current();
    if (!cur.isBot) return cur.id;
    if (S.humans === 1) return g.players.find(p => !p.isBot).id;
    return cur.id;
  }
  function isHumanTurn() {
    const g = S.game;
    return g && !g.over && !g.pending && !g.current().isBot && !S.busy && !S.advancing;
  }

  function buildGauge() {
    const ticks = [];
    for (let v = 0; v <= GAUGE_MAX; v += 5) {
      const x = v / GAUGE_MAX * 100;
      ticks.push(`<i style="left:${x}%"></i>`);
      if (v % 10 === 0 && v !== 0 && v !== GAUGE_MAX) ticks.push(`<b style="left:${x}%">${v}</b>`);
    }
    $('#co2-ticks').innerHTML = ticks.join('');
    $('#co2-goal').style.left = (cfg().TARGET_GES / GAUGE_MAX * 100) + '%';
    $('#co2-goal').title = 'Objectif : ' + cfg().TARGET_GES + ' ou moins';
  }

  function render() {
    const g = S.game;
    if (!g) return;
    renderTop(); renderMap(); renderPiles(); renderOpponents(); renderTray();
  }

  function renderTop() {
    const g = S.game;
    $('#years').innerHTML = Array.from({ length: g.cfg.YEARS }, (_, i) => {
      const y = i + 1;
      const cls = g.over ? 'past' : y < g.year ? 'past' : y === g.year ? 'now' : '';
      return `<span class="year ${cls}" title="Année ${y}">${y}</span>`;
    }).join('');
    $('#years').setAttribute('aria-label', `Année ${g.year} sur ${g.cfg.YEARS}`);
    if (S.lastGes !== g.ges) { S.gesDir = g.ges < S.lastGes ? 'down' : 'up'; S.lastGes = g.ges; }
    const tok = $('#co2-token');
    tok.style.left = (Math.min(Math.max(g.ges, 0), GAUGE_MAX) / GAUGE_MAX * 100) + '%';
    tok.className = 'co2-token ' + S.gesDir;
    $('#co2-value').textContent = g.ges;
    $('#co2').title = `CO₂-mètre : ${g.ges} (objectif ${g.cfg.TARGET_GES} ou moins)`;
  }

  function renderMap() {
    const g = S.game, cur = g.over ? null : g.current();
    $('#map-layer').innerHTML = g.players.map(p => {
      const d = deptOf(p);
      if (!d) return '';
      const builds = p.realized.map(r => {
        const pd = projDef(r.card);
        const t = pd.type === 'transition';
        return `<span class="build ${t ? 't' : 'a'}" title="${esc(pd.name)}">${r.gesDelta > 0 ? '+' : ''}${r.gesDelta}</span>`;
      }).join('');
      return `<div class="dept ${cur && cur.id === p.id ? 'active' : ''} ${p.alive ? '' : 'dead'}" style="left:${d.x}%;top:${d.y}%" data-map-dept="${p.id}">
        <span class="dept-token" title="${esc(p.name)}">${d.code}</span>
        <span class="dept-builds">${builds}</span></div>`;
    }).join('');
  }

  function renderPiles() {
    const g = S.game;
    $('#count-jobs').textContent = g.jobDeck.length;
    $('#count-projects').textContent = g.projectDeck.length;
    $('#count-alea').textContent = g.cfg.ALEAS_ENABLED ? g.aleaDeck.length : '–';
    const can = isHumanTurn() && g.can('draw_job');
    const pile = $('#pile-jobs');
    pile.classList.toggle('can', can);
    pile.disabled = !can;
    pile.title = can ? `Recruter depuis la pioche (${g.cfg.JOB_DRAW_COST} pièce)` : 'Pioche métiers';
  }

  function kindLabel(p) { return p.isBot ? LEVEL_LABEL[p.level] || 'IA' : 'Humain'; }

  function renderOpponents() {
    const g = S.game, tray = trayPlayerId(), cur = g.over ? null : g.current();
    const humanBuying = isHumanTurn() && g.phase === 'jobs';
    $('#opponents').innerHTML = g.players.filter(p => p.id !== tray).map(p => {
      const d = deptOf(p);
      const gesSum = p.realized.reduce((a, r) => a + r.gesDelta, 0);
      const jobs = p.jobs.map(j => {
        const jd = jobDef(j);
        const buyable = humanBuying && g.can('request_buy', { targetId: p.id, cardUid: j.uid });
        return `<button class="mini ${buyable ? 'buyable' : ''}" data-pop data-opp-job="${p.id}:${j.uid}" style="background-image:url('${jd.img}');--c:${D.COLORS[jd.color].hex}" title="${esc(jd.name)}" aria-label="${esc(jd.name)} (${esc(p.name)})"></button>`;
      }).join('') || `<span class="muted" style="font-size:13px">aucun métier</span>`;
      const status = !p.alive ? `Éliminé en année ${p.eliminatedYear}` :
        `${plural(p.projects.length, 'projet')} en main · ${plural(p.realized.length, 'réalisé')}` + (p.realized.length ? ` (CO₂ ${gesSum > 0 ? '+' : ''}${gesSum})` : '');
      return `<div class="opp ${cur && cur.id === p.id ? 'active' : ''} ${p.alive ? '' : 'dead'}">
        <div class="opp-head"><span class="opp-name">${esc(p.name)}</span>
          <span class="opp-kind">${d ? d.code + ' · ' : ''}${kindLabel(p)}</span>
          <span class="opp-coins" title="Pièces">${coins(p.coins)}</span></div>
        <div class="opp-body"><div class="opp-row" data-jobs-of="${p.id}">${jobs}</div>
        <div class="opp-meta">${status}</div></div></div>`;
    }).join('');
  }

  function projectTag(st) {
    if (st.ok) return 'Réalisable';
    const parts = [];
    if (st.missing.length) parts.push('Manque ' + st.missing.map(colorSq).join(''));
    if (st.lackCoins) parts.push(`−${st.lackCoins}<span class="coin-dot"></span>`);
    return parts.join(' ');
  }

  function renderTray() {
    const g = S.game, tid = trayPlayerId(), p = g.players[tid], cur = g.over ? null : g.current();
    const mine = cur && cur.id === tid && !p.isBot;
    const privateView = !p.isBot;
    const d = deptOf(p);
    let mode;
    if (!p.alive) mode = `Département éliminé en année ${p.eliminatedYear}`;
    else if (mine) mode = 'C’est ton tour';
    else if (cur) mode = `Au tour de ${esc(cur.name)}${cur.isBot ? ' (' + kindLabel(cur) + ')' : ''}`;
    else mode = '';
    $('#tray-head').innerHTML = `<span class="tray-name">${esc(p.name)}</span>
      <span class="muted">${d ? d.code + ' · ' : ''}${kindLabel(p)}</span>
      <span class="tray-coins" title="Pièces">${coins(p.coins)}</span>
      <span class="tray-mode">${mode}</span>`;

    // métiers (toujours visibles : on doit pouvoir les acheter)
    const canSell = mine && g.phase === 'jobs' && isHumanTurn();
    $('#tray-jobs').dataset.jobsOf = tid;
    $('#tray-jobs').innerHTML = p.jobs.map(j => {
      const jd = jobDef(j);
      return `<button class="card ${S.sellMode && canSell ? 'selling' : ''}" data-pop data-own-job="${j.uid}" title="${esc(jd.name)}">
        <img src="${jd.img}" alt="${esc(jd.name)}" draggable="false"></button>`;
    }).join('') || `<p class="empty-hand">Aucune carte métier. Recrute dans la pioche ou achète à un autre département.</p>`;
    $('#jobs-hint').textContent = S.sellMode && canSell ? '· clique la carte à vendre' : '';

    // projets
    $('#tray-projects').innerHTML = privateView ? p.projects.map(pc => {
      const pd = projDef(pc), st = g.projectStatus(p, pc);
      return `<button class="card ${st.ok ? 'ready' : 'blocked'}" data-project="${pc.uid}" title="${esc(pd.name)}">
        <img src="${pd.img}" alt="${esc(pd.name)}" draggable="false"><span class="tag">${projectTag(st)}</span></button>`;
    }).join('') || `<p class="empty-hand">Aucun projet en main.</p>`
      : p.projects.map(() => `<span class="card back-card" aria-hidden="true"></span>`).join('');

    renderDock(p, mine);
  }

  function renderDock(p, mine) {
    const g = S.game, c = g.cfg, dock = $('#dock');
    const cur = g.over ? null : g.current();
    if (!cur) { dock.innerHTML = ''; return; }
    if (g.pending) {
      dock.innerHTML = `<div class="dock-step">Demande d'achat</div><p class="dock-help">En attente de la réponse de ${esc(pname(g.pending.seller))}…</p>`;
      return;
    }
    if (cur.isBot || !mine) {
      dock.innerHTML = `<div class="dock-step">${esc(cur.name)} joue</div><div class="thinking" aria-label="L'IA réfléchit"><i></i><i></i><i></i></div>`;
      return;
    }
    if (g.phase === 'jobs') {
      const done = c.JOB_ACTIONS - g.jobActionsLeft;
      const pips = Array.from({ length: c.JOB_ACTIONS }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
      const canDraw = g.can('draw_job'), canSell = g.can('sell_job'), canBuy = g.can('request_buy');
      dock.innerHTML = `
        <div class="dock-step">Actions métier <span class="pips" aria-label="${done} sur ${c.JOB_ACTIONS}">${pips}</span></div>
        <p class="dock-help">Encore ${plural(g.jobActionsLeft, 'action')}. Pour acheter, clique une carte métier d'un autre département (${c.JOB_TRADE_COST} pièces, il peut refuser).</p>
        <button class="btn small" data-do="draw" ${canDraw ? '' : 'disabled'}>Recruter dans la pioche <span class="cost">−${c.JOB_DRAW_COST}<span class="coin-dot"></span></span></button>
        <button class="btn small ${S.sellMode ? 'tension' : ''}" data-do="sell" ${canSell ? '' : 'disabled'}>${S.sellMode ? 'Annuler la vente' : 'Vendre une carte métier'} <span class="cost">+${c.JOB_SELL_GAIN}<span class="coin-dot"></span></span></button>
        <button class="btn small ghost" data-do="end_jobs">Passer à l'action projet</button>
        ${!canBuy && g.refusedBy.size ? '<p class="dock-help">Les départements qui ont refusé ne peuvent plus être sollicités ce tour-ci.</p>' : ''}`;
    } else {
      const ready = p.projects.some(pc => g.projectStatus(p, pc).ok);
      dock.innerHTML = `
        <div class="dock-step">Action projet</div>
        <p class="dock-help">${ready ? 'Clique un projet <strong>réalisable</strong> pour le lancer, ou un autre projet pour le changer.' : 'Aucun projet réalisable : clique un projet pour le changer contre une nouvelle carte.'}${c.PROJECT_CHANGE_GAIN ? ` Changer rapporte ${c.PROJECT_CHANGE_GAIN} pièce.` : ''}</p>
        <button class="btn small ghost" data-do="skip_project">Ne rien faire ce tour</button>`;
    }
  }

  /* ===================================================================
     Journal
     =================================================================== */
  function log(html, cls) {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    const ol = $('#log');
    ol.appendChild(li);
    ol.scrollTop = ol.scrollHeight;
  }
  function logYear(y) { log(`Année ${y}`, 'year-line'); }
  const B = s => `<strong>${esc(s)}</strong>`;

  /* ===================================================================
     Actions des joueurs humains
     =================================================================== */
  async function doAction(action) {
    if (!isHumanTurn()) return;
    S.busy = true;
    closePopover();
    if (action.type !== 'sell_job') S.sellMode = false;
    try {
      const ev = S.game.act(action);
      if (action.type === 'sell_job') S.sellMode = false;
      await handleEvents(ev);
    } finally { S.busy = false; }
    advance();
  }

  document.addEventListener('click', e => {
    if (!S.game || $('#screen-game').hidden) return;
    const g = S.game;
    const btn = e.target.closest('[data-do]');
    if (btn && !btn.disabled) {
      const k = btn.dataset.do;
      if (k === 'draw') doAction({ type: 'draw_job' });
      else if (k === 'sell') { S.sellMode = !S.sellMode; render(); }
      else if (k === 'end_jobs') doAction({ type: 'end_jobs' });
      else if (k === 'skip_project') doAction({ type: 'skip_project' });
      return;
    }
    if (e.target.closest('#pile-jobs')) { if (isHumanTurn() && g.can('draw_job')) doAction({ type: 'draw_job' }); return; }

    const own = e.target.closest('[data-own-job]');
    if (own) {
      const uid = +own.dataset.ownJob;
      const p = g.players[trayPlayerId()];
      const card = p.jobs.find(j => j.uid === uid);
      if (!card) return;
      const canSell = isHumanTurn() && g.current().id === p.id && g.can('sell_job', { cardUid: uid });
      if (S.sellMode && canSell) { doAction({ type: 'sell_job', cardUid: uid }); return; }
      const btns = [];
      if (canSell) btns.push({ label: `Vendre <span class="cost">+${g.cfg.JOB_SELL_GAIN}<span class="coin-dot"></span></span>`, primary: true, run: () => doAction({ type: 'sell_job', cardUid: uid }) });
      btns.push({ label: 'Voir la fiche métier', run: () => openJob(card.key) });
      openPopover(own, jobDef(card).name, btns);
      return;
    }

    const opp = e.target.closest('[data-opp-job]');
    if (opp) {
      const [pid, uid] = opp.dataset.oppJob.split(':').map(Number);
      const seller = g.players[pid];
      const card = seller.jobs.find(j => j.uid === uid);
      if (!card) return;
      const btns = [];
      if (isHumanTurn() && g.phase === 'jobs') {
        const ok = g.can('request_buy', { targetId: pid, cardUid: uid });
        let note = '';
        if (!ok) note = g.refusedBy.has(pid) ? `${seller.name} a déjà refusé ce tour-ci.` : g.current().coins < g.cfg.JOB_TRADE_COST ? 'Pas assez de pièces.' : '';
        btns.push({ label: `Proposer d'acheter <span class="cost">−${g.cfg.JOB_TRADE_COST}<span class="coin-dot"></span></span>`, primary: true, disabled: !ok, note, run: () => doAction({ type: 'request_buy', targetId: pid, cardUid: uid }) });
      }
      btns.push({ label: 'Voir la fiche métier', run: () => openJob(card.key) });
      openPopover(opp, `${jobDef(card).name} — ${seller.name}`, btns);
      return;
    }

    const proj = e.target.closest('[data-project]');
    if (proj) { openProject(+proj.dataset.project); return; }

    const opener = e.target.closest('[data-open]');
    if (opener) {
      if (opener.dataset.open === 'rules') openRules();
      if (opener.dataset.open === 'howto') openHowto();
    }
  });
  // boutons d'information disponibles aussi sur l'accueil
  $('#screen-setup').addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (!o) return;
    if (o.dataset.open === 'rules') openRules();
    if (o.dataset.open === 'howto') openHowto();
  });
  $('#btn-menu').addEventListener('click', openMenu);

  /* ===================================================================
     Fiches et fenêtres
     =================================================================== */
  function openJob(key) {
    const jd = D.JOBS[key], col = D.COLORS[jd.color];
    return openModal(`<div class="detail">
        <img src="${jd.img}" alt="Carte ${esc(jd.name)}">
        <div>
          <h2>${esc(jd.name)}</h2>
          <span class="family">${colorSq(jd.color)} ${esc(col.label)}</span>
          <p>${esc(jd.desc)}</p>
          <p class="muted">${esc(jd.fact)}</p>
          <div class="modal-actions">
            <a class="btn tension" href="${D.LINKS.onisep}" target="_blank" rel="noopener">Découvrir les formations (ONISEP)</a>
            <button class="btn ghost" data-value="close" data-autofocus>Fermer</button>
          </div>
        </div></div>`);
  }

  function openProject(uid) {
    const g = S.game, p = g.players[trayPlayerId()];
    const card = p.projects.find(x => x.uid === uid);
    if (!card) return;
    const pd = projDef(card), st = g.projectStatus(p, card);
    const myTurn = isHumanTurn() && g.current().id === p.id;
    const isT = pd.type === 'transition';
    let reason = '';
    if (!st.ok) {
      const r = [];
      if (st.missing.length) r.push('il te manque ' + st.missing.map(c => `${colorSq(c)} ${esc(D.COLORS[c].short)}`).join(', '));
      if (st.lackCoins) r.push(`il te manque ${plural(st.lackCoins, 'pièce')}`);
      reason = `<p class="reason">Pas encore réalisable : ${r.join(' et ')}.</p>`;
    }
    const btns = [];
    if (myTurn && g.phase === 'project') {
      btns.push(`<button class="btn tension" data-value="realize" ${st.ok ? 'data-autofocus' : 'disabled'}>Réaliser ce projet</button>`);
      btns.push(`<button class="btn" data-value="change">Changer ce projet${g.cfg.PROJECT_CHANGE_GAIN ? ` <span class="cost">+${g.cfg.PROJECT_CHANGE_GAIN}<span class="coin-dot"></span></span>` : ''}</button>`);
    } else if (myTurn && g.phase === 'jobs') {
      if (st.ok) btns.push(`<button class="btn tension" data-value="end_and_realize" data-autofocus>Terminer les actions métier et réaliser</button>`);
      reason += `<p class="muted">Les projets se jouent après tes ${g.cfg.JOB_ACTIONS} actions métier.</p>`;
    }
    btns.push(`<button class="btn ghost" data-value="close">Fermer</button>`);
    const jobsHtml = pd.jobs.length ? pd.jobs.map(c => `${colorSq(c)} ${esc(D.COLORS[c].short)}`).join(' · ') : 'aucun';
    openModal(`<div class="detail">
        <img src="${pd.img}" alt="Carte ${esc(pd.name)}">
        <div>
          <h2>${esc(pd.name)}</h2>
          <span class="family">${isT ? 'Projet de transition : fait baisser le CO₂' : 'Projet d’attractivité : rapporte des pièces mais pollue'}</span>
          <dl class="stats">
            <dt>Coût</dt><dd>${coins(pd.cost)}</dd>
            <dt>Gain</dt><dd>${pd.gain ? '+' + coins(pd.gain) : '–'}</dd>
            <dt>CO₂</dt><dd class="delta ${pd.ges < 0 ? 'down' : 'up'}">${pd.ges > 0 ? '+' : ''}${pd.ges}</dd>
          </dl>
          <p>Métiers requis : ${jobsHtml}</p>
          <p class="muted">${esc(pd.fact)}</p>
          ${reason}
          <div class="modal-actions">${btns.join('')}</div>
        </div></div>`).then(async v => {
      if (v === 'realize') doAction({ type: 'realize', projectUid: uid });
      else if (v === 'change') doAction({ type: 'change_project', projectUid: uid });
      else if (v === 'end_and_realize') {
        if (!isHumanTurn()) return;
        S.busy = true;
        try { await handleEvents(g.act({ type: 'end_jobs' })); } finally { S.busy = false; }
        doAction({ type: 'realize', projectUid: uid });
      }
    });
  }

  function rulesHtml(c) {
    c = c || D.CONFIG;
    return `<div class="rules">
      <h2>Règles du jeu</h2>
      <p>Chaque joueur dirige un département de la Bourgogne-Franche-Comté. Le but est de réaliser des projets de transition énergétique pour atteindre un objectif régional commun, tout en subvenant aux besoins de son département.</p>
      <h3>Mise en place</h3>
      <p>Chaque département reçoit ${c.STARTING_JOBS} cartes métier, ${c.STARTING_COINS} pièces et ${c.STARTING_PROJECTS} cartes projet. Le jeton du CO₂-mètre part de ${c.STARTING_GES}.</p>
      <h3>Un tour de jeu</h3>
      <p>Chaque joueur fait d'abord ${c.JOB_ACTIONS} actions métier, puis une action projet.</p>
      <ul>
        <li><strong>Recruter</strong> : payer ${plural(c.JOB_DRAW_COST, 'pièce')} et piocher la carte du dessus de la pioche métiers.</li>
        <li><strong>Acheter à un autre joueur</strong> : lui payer ${c.JOB_TRADE_COST} pièces pour une carte métier de son choix, s'il accepte.</li>
        <li><strong>Vendre</strong> : défausser une carte métier pour gagner ${plural(c.JOB_SELL_GAIN, 'pièce')}.</li>
        <li><strong>Réaliser un projet</strong> : payer son coût et défausser les cartes métier des couleurs indiquées, puis appliquer l'effet.</li>
        <li><strong>Changer de projet</strong> : défausser un projet de sa main et en piocher un nouveau${c.PROJECT_CHANGE_GAIN ? ` (+${plural(c.PROJECT_CHANGE_GAIN, 'pièce')})` : ''}.</li>
      </ul>
      <h3>Les cartes</h3>
      <p>Les projets de transition font baisser le CO₂-mètre. Les projets d'attractivité rapportent des pièces tout de suite, mais le font monter. Les cartes métier n'ont pas d'effet en elles-mêmes : il en faut de la bonne famille pour réaliser un projet.</p>
      <ul>${D.COLOR_ORDER.map(k => `<li>${colorSq(k)} ${esc(D.COLORS[k].label)}</li>`).join('')}</ul>
      <h3>Fin d'année</h3>
      <p>Quand tout le monde a joué, on retourne une carte aléa et on applique son effet. Puis chaque département paie ${c.TAX_AMOUNT} pièces. Un département qui ne peut pas payer est éliminé : ses cartes métier sont partagées entre ses deux voisins de table, ses projets réalisés restent sur la carte.</p>
      <h3>Fin de la partie</h3>
      <p>Après ${c.YEARS} années, les départements encore en jeu gagnent ensemble si le CO₂-mètre est à ${c.TARGET_GES} ou moins.</p>
      <p class="muted">Aujourd'hui, la Bourgogne-Franche-Comté émet 20 millions de tonnes d'équivalent CO₂ par an. L'objectif réel : descendre à 13 d'ici 10 ans.</p>
      <div class="modal-actions"><button class="btn primary" data-value="close" data-autofocus>Fermer</button></div></div>`;
  }
  function openRules() { return openModal(rulesHtml(S.game && !$('#screen-game').hidden ? S.game.cfg : null), { wide: true }); }

  function openHowto() {
    const c = S.game ? S.game.cfg : D.CONFIG;
    return openModal(`<div class="howto">
      <h2>Comment jouer</h2>
      <ol>
        <li>Ton département commence avec ${c.STARTING_COINS} pièces, ${c.STARTING_JOBS} cartes métier et ${c.STARTING_PROJECTS} cartes projet.</li>
        <li>À ton tour, fais ${c.JOB_ACTIONS} actions métier : recruter dans la pioche, acheter une carte à un autre département (il peut refuser) ou vendre une carte.</li>
        <li>Puis une action projet : réalise un projet en payant son coût et en défaussant les métiers des bonnes couleurs, ou change un projet.</li>
        <li>Les projets de transition font baisser le CO₂-mètre ; ceux d'attractivité rapportent des pièces mais le font monter.</li>
        <li>En fin d'année, une carte aléa est retournée, puis chacun paie ${c.TAX_AMOUNT} pièces. Qui ne peut pas payer est éliminé.</li>
        <li>Après ${c.YEARS} ans, si le CO₂-mètre est à ${c.TARGET_GES} ou moins, les départements encore en jeu gagnent ensemble.</li>
      </ol>
      <p class="muted">Astuce : clique sur n'importe quelle carte métier pour découvrir le métier.</p>
      <div class="modal-actions"><button class="btn primary" data-value="close" data-autofocus>C'est parti</button></div></div>`);
  }

  async function openMenu() {
    const v = await openModal(`<h2>Menu</h2>
      <div class="modal-actions">
        <button class="btn primary" data-value="resume" data-autofocus>Reprendre la partie</button>
        <button class="btn" data-value="restart">Recommencer avec les mêmes joueurs</button>
        <button class="btn ghost" data-value="home">Retour à l'accueil</button>
      </div>`);
    if (v === 'restart') startGame(S.lastSetup);
    if (v === 'home') goHome();
  }
  function goHome() {
    S.gen++; S.game = null;
    closeModal(null);
    $('#handoff').hidden = true;
    $('#screen-game').hidden = true; $('#screen-end').hidden = true; $('#screen-setup').hidden = false;
  }

  /* ---------- passage de l'appareil entre deux humains ---------- */
  function handoff(p) {
    return new Promise(res => {
      const el = $('#handoff');
      el.innerHTML = `<div><h2>Au tour de ${esc(p.name)}</h2>
        <p>Année ${S.game.year} sur ${S.game.cfg.YEARS}. Passe l'appareil : les autres ne regardent pas la main.</p>
        <button class="btn primary big" id="handoff-go">Je suis ${esc(p.name)}, afficher ma main</button></div>`;
      el.hidden = false;
      $('#handoff-go').focus();
      $('#handoff-go').onclick = () => { el.hidden = true; res(); };
    });
  }

  /* ---------- demande d'achat adressée à un humain ---------- */
  async function askTrade(t) {
    const g = S.game, jd = jobDef(t.card), buyer = g.players[t.buyer], seller = g.players[t.seller];
    const v = await openModal(`<div class="detail">
      <img src="${jd.img}" alt="Carte ${esc(jd.name)}">
      <div><h2>${esc(seller.name)}, une proposition</h2>
        <p>${B(buyer.name)} veut t'acheter ta carte ${B(jd.name)} pour ${coins(t.price)}.</p>
        <p class="muted">Tu as ${coins(seller.coins)}. Si tu acceptes, tu passeras à ${coins(seller.coins + t.price)} mais tu n'auras plus cette carte pour tes projets.</p>
        <div class="modal-actions">
          <button class="btn tension" data-value="yes" data-autofocus>Accepter la vente</button>
          <button class="btn" data-value="no">Refuser</button>
        </div></div></div>`, { dismissable: false });
    return v === 'yes';
  }

  /* ---------- projet réalisé : mise en avant ---------- */
  function spotlight(e) {
    return new Promise(res => {
      const g = S.game, pd = projDef(e.card), p = g.players[e.player];
      const el = $('#spotlight');
      const d = e.gesAfter - e.gesBefore;
      const money = e.gain - e.cost;
      el.innerHTML = `<img src="${pd.img}" alt="">
        <div><div class="who">${esc(p.name)} réalise</div>
          <h3>${esc(pd.name)}</h3>
          <div class="delta ${d <= 0 ? 'down' : 'up'}">CO₂ ${e.gesBefore} → ${e.gesAfter}</div>
          ${money ? `<div class="muted">${money > 0 ? '+' : ''}${money} pièce${Math.abs(money) > 1 ? 's' : ''}</div>` : ''}
          <p class="fact">${esc(pd.fact)}</p>
          <div class="dismiss">Clique pour continuer</div></div>`;
      el.hidden = false;
      const human = !p.isBot;
      const ms = human ? TIMING.spotHuman : TIMING.spotBot[S.speed];
      let done = false;
      const finish = () => { if (done) return; done = true; el.hidden = true; el.onclick = null; res(); };
      el.onclick = finish;
      setTimeout(finish, ms);
    });
  }

  /* ---------- fin d'année ---------- */
  async function yearEnd(events) {
    const g = S.game;
    const alea = events.find(e => e.type === 'alea');
    const tax = events.find(e => e.type === 'tax');
    const elim = events.filter(e => e.type === 'eliminated');
    const endYear = (events.find(e => e.type === 'year_end') || {}).year;
    const over = events.some(e => e.type === 'game_over');
    let aleaHtml = '';
    if (alea) {
      const ad = D.ALEAS[alea.card.key];
      aleaHtml = (ad.img ? `<img src="${ad.img}" alt="Carte aléa ${esc(ad.name)}">` : `<div class="alea-card">${esc(ad.name)}</div>`);
    }
    const taxLines = tax ? tax.taxes.map(t => {
      const p = g.players[t.player];
      if (t.paid) return `<li>${esc(p.name)} paie ${coins(t.amount)} : il lui reste ${coins(p.coins)}</li>`;
      const e = elim.find(x => x.player === t.player);
      const heirs = e && e.heirs.length ? ` Ses métiers partent chez ${e.heirs.map(h => esc(pname(h))).join(' et ')}.` : '';
      return `<li class="ko">${esc(p.name)} ne peut pas payer : département éliminé.${heirs}</li>`;
    }).join('') : '';
    const ad = alea ? D.ALEAS[alea.card.key] : null;
    const body = `
      <h2>Fin de l'année ${endYear}</h2>
      <div class="${alea ? 'year-end' : ''}">
        ${aleaHtml ? `<div>${aleaHtml}</div>` : ''}
        <div>
          ${ad ? `<h3>Aléa : ${esc(ad.name)}</h3><p>${esc(ad.text)}</p><p class="muted">${esc(ad.fact)}</p>` : ''}
          <h3>Taxe du département (${g.cfg.TAX_AMOUNT} pièces)</h3>
          <ul class="tax-list">${taxLines}</ul>
          <p>CO₂-mètre : <strong>${g.ges}</strong> (objectif ${g.cfg.TARGET_GES} ou moins)${over ? '' : `, il reste ${plural(g.cfg.YEARS - endYear, 'année')}.`}</p>
          <div class="modal-actions"><button class="btn primary" data-value="next" data-autofocus>${over ? 'Voir le bilan' : `Commencer l'année ${endYear + 1}`}</button></div>
        </div>
      </div>`;
    const p = openModal(body, { wide: true, dismissable: false });
    if (S.humans === 0) { if (await sleep(TIMING.demoYearEnd) && !$('#modal').hidden) closeModal('next'); }
    await p;
  }

  /* ===================================================================
     Traitement des événements du moteur
     =================================================================== */
  async function handleEvents(events) {
    const g = S.game, gen = S.gen;
    let yearEvents = null;
    for (const e of events) {
      if (gen !== S.gen) return;
      if (yearEvents) { yearEvents.push(e); continue; }
      switch (e.type) {
        case 'illegal':
          toast('Cette action n’est pas possible maintenant.', true);
          break;
        case 'draw_job': {
          const jd = jobDef(e.card);
          const from = rectOf('#pile-jobs');
          render();
          await fly(from, rectOf(`[data-jobs-of="${e.player}"]`), jd.img);
          log(`${B(pname(e.player))} recrute ${esc(jd.name)}`);
          break;
        }
        case 'sell_job': {
          const jd = jobDef(e.card);
          const from = rectOf(`[data-own-job="${e.card.uid}"]`) || rectOf(`[data-opp-job="${e.player}:${e.card.uid}"]`) || rectOf(`[data-jobs-of="${e.player}"]`);
          render();
          await fly(from, rectOf('[data-pile="discard"]'), jd.img);
          log(`${B(pname(e.player))} vend ${esc(jd.name)} (+${e.gain})`);
          break;
        }
        case 'trade_request':
          log(`${B(pname(e.player))} propose d'acheter ${esc(jobDef(e.card).name)} à ${B(pname(e.seller))}`);
          render();
          break;
        case 'trade_accepted': {
          const jd = jobDef(e.card);
          const from = rectOf(`[data-opp-job="${e.seller}:${e.card.uid}"]`) || rectOf(`[data-own-job="${e.card.uid}"]`) || rectOf(`[data-jobs-of="${e.seller}"]`);
          render();
          await fly(from, rectOf(`[data-jobs-of="${e.player}"]`), jd.img);
          log(`${B(pname(e.seller))} vend ${esc(jd.name)} à ${B(pname(e.player))} (${e.price} pièces)`);
          if (!g.players[e.player].isBot || !g.players[e.seller].isBot) toast(`${pname(e.seller)} accepte de vendre ${jd.name}.`);
          break;
        }
        case 'trade_refused':
          log(`${B(pname(e.seller))} refuse de vendre ${esc(jobDef(e.card).name)}`);
          if (!g.players[e.player].isBot) toast(`${pname(e.seller)} refuse de vendre.`, true);
          render();
          break;
        case 'realize': {
          render();
          const pd = projDef(e.card);
          const d = e.gesAfter - e.gesBefore;
          log(`${B(pname(e.player))} réalise ${esc(pd.name)} : CO₂ ${e.gesBefore} → ${e.gesAfter}`, d <= 0 ? 'good' : 'bad');
          await spotlight(e);
          break;
        }
        case 'change_project':
          log(`${B(pname(e.player))} change de projet (${esc(projDef(e.card).name)} défaussé)`);
          break;
        case 'skip_project':
          log(`${B(pname(e.player))} ne lance aucun projet`);
          break;
        case 'year_end':
          yearEvents = [e];
          break;
      }
    }
    render();
    if (yearEvents) {
      for (const e of yearEvents) {
        if (e.type === 'alea') log(`Aléa : ${esc(D.ALEAS[e.card.key].name)}. ${esc(D.ALEAS[e.card.key].text)}`, e.changes.some(c => c.delta) ? 'bad' : '');
        if (e.type === 'eliminated') log(`${B(pname(e.player))} ne peut pas payer et est éliminé`, 'bad');
      }
      await yearEnd(yearEvents);
      if (gen !== S.gen) return;
      const ys = yearEvents.find(e => e.type === 'year_start');
      if (ys) logYear(ys.year);
      render();
    }
  }

  /* ===================================================================
     Boucle de jeu : fait jouer les bots, attend les humains
     =================================================================== */
  async function advance() {
    if (S.advancing) return;
    S.advancing = true;
    const gen = S.gen;
    try {
      while (gen === S.gen) {
        const g = S.game;
        if (!g) return;
        if (g.over) { showEnd(); return; }

        if (g.pending) {
          const seller = g.players[g.pending.seller];
          render();
          let accept;
          if (seller.isBot) {
            if (!(await sleep(SPEED[S.speed] * 0.7))) return;
            accept = S.bots[seller.id].respondTrade(g.pending);
          } else {
            accept = await askTrade(g.pending);
            if (gen !== S.gen) return;
          }
          await handleEvents(g.act({ type: 'respond_trade', accept }));
          continue;
        }

        const cur = g.current();
        if (cur.isBot) {
          render();
          if (!(await sleep(SPEED[S.speed]))) return;
          let ev = g.act(S.bots[cur.id].decide());
          if (ev[0] && ev[0].type === 'illegal') ev = g.act({ type: g.phase === 'jobs' ? 'end_jobs' : 'skip_project' });
          await handleEvents(ev);
          continue;
        }

        // tour d'un humain
        if (S.humans > 1 && S.viewer !== cur.id) {
          render();
          $('#tray').style.visibility = 'hidden';
          await handoff(cur);
          $('#tray').style.visibility = '';
          if (gen !== S.gen) return;
        }
        S.viewer = cur.id;
        break;
      }
    } finally {
      if (gen === S.gen) S.advancing = false;
    }
    render();
  }

  /* ===================================================================
     Bilan de fin de partie
     =================================================================== */
  function gesChart(hist, target) {
    const W = 520, H = 220, L = 34, R = 10, T = 12, Bm = 28;
    const maxY = Math.max(GAUGE_MAX, ...hist);
    const x = i => L + i * (W - L - R) / (hist.length - 1);
    const y = v => T + (1 - v / maxY) * (H - T - Bm);
    const pts = hist.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const yt = [0, 10, 20, 30, 40, 50].filter(v => v <= maxY);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du CO₂-mètre, de ${hist[0]} à ${hist[hist.length - 1]}">
      ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(236,227,211,.12)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="#8fd19a" stroke-width="2" stroke-dasharray="6 5"/>
      <text x="${L + 6}" y="${y(target) + 15}" style="fill:#8fd19a">objectif ${target}</text>
      ${hist.map((v, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i === 0 ? 'départ' : i}</text>`).join('')}
      <polyline points="${pts}" fill="none" stroke="#ece3d3" stroke-width="3" stroke-linejoin="round"/>
      ${hist.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${v <= target ? '#5fb3d9' : '#e98a72'}"/>`).join('')}
    </svg>`;
  }

  function showEnd() {
    const g = S.game;
    const alive = g.alivePlayers();
    let verdict, sub;
    if (g.win) {
      verdict = 'Objectif atteint';
      sub = `Le CO₂-mètre termine à ${g.ges}, sous l'objectif de ${g.cfg.TARGET_GES}. ${alive.length === g.players.length ? 'Tous les départements' : alive.map(p => p.name).join(', ')} ${alive.length > 1 ? 'gagnent' : 'gagne'} la partie.`;
    } else if (!alive.length) {
      verdict = 'Région en faillite';
      sub = `Tous les départements ont été éliminés. Le CO₂-mètre s'est arrêté à ${g.ges}.`;
    } else {
      verdict = 'Objectif manqué';
      sub = `Le CO₂-mètre termine à ${g.ges} : il fallait descendre à ${g.cfg.TARGET_GES}. Il a manqué ${g.ges - g.cfg.TARGET_GES} point${g.ges - g.cfg.TARGET_GES > 1 ? 's' : ''}.`;
    }
    const rows = g.players.map(p => {
      const t = p.realized.filter(r => projDef(r.card).type === 'transition').length;
      const a = p.realized.length - t;
      const sum = p.realized.reduce((s, r) => s + r.gesDelta, 0);
      return `<tr><td><strong>${esc(p.name)}</strong> <span class="muted">${kindLabel(p)}</span></td>
        <td class="num">${t}</td><td class="num">${a}</td>
        <td class="num delta ${sum <= 0 ? 'down' : 'up'}">${sum > 0 ? '+' : ''}${sum}</td>
        <td class="num">${p.alive ? p.coins : '–'}</td>
        <td>${p.alive ? 'En jeu' : `Éliminé (année ${p.eliminatedYear})`}</td></tr>`;
    }).join('');
    const top = Object.entries(g.jobUsage).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topHtml = top.length ? top.map(([k, n]) => `<figure style="margin:0">
        <button class="card" data-job-key="${k}"><img src="${D.JOBS[k].img}" alt="${esc(D.JOBS[k].name)}"></button>
        <figcaption>${esc(D.JOBS[k].name)} : ${plural(n, 'fois', 'fois')}</figcaption></figure>`).join('')
      : '<p class="muted">Aucun projet n’a été réalisé.</p>';

    const end = $('#screen-end');
    end.innerHTML = `<div class="end">
      <h1 class="end-verdict ${g.win ? 'win' : 'lose'}">${verdict}</h1>
      <p class="end-sub">${esc(sub)}</p>
      <div class="end-grid">
        <div class="panel"><h2>Le CO₂-mètre, année après année</h2>${gesChart(g.gesHistory, g.cfg.TARGET_GES)}</div>
        <div class="panel"><h2>Les métiers les plus mobilisés</h2>
          <div class="top-jobs">${topHtml}</div>
          <p class="muted" style="margin-bottom:0">Clique sur un métier pour découvrir ce qu’il fait et comment s’y former.</p></div>
      </div>
      <div class="panel" style="margin-top:22px"><h2>Les départements</h2>
        <table class="end-table"><thead><tr><th>Département</th><th class="num">Projets de transition</th><th class="num">Projets d’attractivité</th><th class="num">Effet sur le CO₂</th><th class="num">Pièces</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="end-actions">
        <button class="btn primary big" id="end-replay">Rejouer avec les mêmes joueurs</button>
        <a class="btn tension big" href="${D.LINKS.questionnaire}" target="_blank" rel="noopener">Donner mon avis sur le jeu</a>
        <a class="btn big" href="${D.LINKS.onisep}" target="_blank" rel="noopener">Découvrir les formations (ONISEP)</a>
        <button class="btn ghost big" id="end-home">Nouvelle partie</button>
      </div></div>`;
    $('#screen-game').hidden = true;
    end.hidden = false;
    window.scrollTo(0, 0);
    $('#end-replay').onclick = () => startGame(S.lastSetup);
    $('#end-home').onclick = goHome;
    end.onclick = e => { const b = e.target.closest('[data-job-key]'); if (b) openJob(b.dataset.jobKey); };
  }

  /* ===================================================================
     Lancement
     =================================================================== */
  initSetup();
  // accès pour les tests automatisés
  window.HT_APP = { S, SPEED, TIMING, startGame, render };
})();
