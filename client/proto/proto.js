/*
 * Sofá Player prototype: Home, details page and player in the Apple TV app's language, driven by a remote
 * (arrows, OK, Back; Menu opens the sources). The player is simulated: the "video" is the title's backdrop and the
 * time runs on a timer, but everything around it is the real flow: pre-resolving on focus, picking the stream for
 * this TV (ranking.js), automatic fallback, subtitles by priority, skip intro, next episode, and the measurements
 * (clicks from Home to the first frame, TTFF, first choice kept), logged in this browser.
 * Plain ES5 like web/, so it runs in the Fire TV's WebView and on older Samsung TVs.
 */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var CAPS = SAMPLE.caps, TITLES = SAMPLE.titles;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  // MARK: - Small helpers

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function now() { return Date.now ? Date.now() : +new Date(); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function minutes(m) { var h = Math.floor(m / 60); return (h ? h + 'h ' : '') + (m % 60 ? (m % 60) + 'min' : ''); }
  function clock(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function translate(e, x, y) {
    var v = 'translate3d(' + x + 'px,' + y + 'px,0)';
    e.style.webkitTransform = v; e.style.transform = v;
  }
  function gradient(t) {
    return 'linear-gradient(135deg, ' + t.colors[0] + ' 0%, ' + t.colors[1] + ' 100%)';
  }

  var toastTimer = 0;
  function toast(text) {
    var t = $('#toast');
    t.innerHTML = '<span>' + esc(text) + '</span>';
    t.className = 'on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3200);
  }

  // MARK: - Art from TMDB (backdrop, Portuguese title logo, episode stills), when there's a key

  var IMG = 'https://image.tmdb.org/t/p/';
  var art = {}, waiting = {};
  function get(url, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 10000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status !== 200) { done(null); return; }
      try { done(JSON.parse(x.responseText)); } catch (e) { done(null); }
    };
    x.ontimeout = x.onerror = function () { done(null); };
    x.send();
  }
  function loadArt(id, done) {
    var t = TITLES[id];
    if (art[id]) { done(art[id]); return; }
    if (!CFG.tmdbKey || !t.tmdb) { done(null); return; }
    if (waiting[id]) { waiting[id].push(done); return; }
    waiting[id] = [done];
    var kind = t.type === 'series' ? 'tv' : 'movie';
    get('https://api.themoviedb.org/3/' + kind + '/' + t.tmdb + '?api_key=' + encodeURIComponent(CFG.tmdbKey) +
        '&language=pt-BR&append_to_response=images&include_image_language=pt,en,null', function (o) {
      var a = {backdrop: '', logo: '', poster: '', seasons: {}};
      if (o) {
        if (o.backdrop_path) a.backdrop = IMG + 'w1280' + o.backdrop_path;
        if (o.poster_path) a.poster = IMG + 'w342' + o.poster_path;
        var logos = (o.images && o.images.logos) || [], pick = null;
        for (var i = 0; i < logos.length && !pick; i++) if (logos[i].iso_639_1 === 'pt') pick = logos[i];
        for (i = 0; i < logos.length && !pick; i++) if (logos[i].iso_639_1 === 'en') pick = logos[i];
        if (pick) a.logo = IMG + 'w500' + pick.file_path.replace(/\.svg$/, '.png');
        // A backdrop without text reads better behind the info, as on the Apple TV app.
        var bds = (o.images && o.images.backdrops) || [];
        for (i = 0; i < bds.length; i++) if (bds[i].iso_639_1 == null) { a.backdrop = IMG + 'w1280' + bds[i].file_path; break; }
        if (o.overview) t.desc = o.overview;
      }
      art[id] = a;
      var list = waiting[id]; delete waiting[id];
      for (var j = 0; j < list.length; j++) list[j](a);
    });
  }
  function loadSeason(id, n, done) {
    var t = TITLES[id];
    loadArt(id, function (a) {
      if (!a) { done(null); return; }
      if (a.seasons[n]) { done(a.seasons[n]); return; }
      get('https://api.themoviedb.org/3/tv/' + t.tmdb + '/season/' + n + '?api_key=' + encodeURIComponent(CFG.tmdbKey) + '&language=pt-BR', function (o) {
        var eps = [];
        if (o && o.episodes) for (var i = 0; i < o.episodes.length; i++) {
          var e = o.episodes[i];
          eps.push({name: e.name, desc: e.overview, still: e.still_path ? IMG + 'w300' + e.still_path : '', runtime: e.runtime});
        }
        a.seasons[n] = eps;
        done(eps);
      });
    });
  }
  function episodeName(id, s, e, done) {
    loadSeason(id, s, function (eps) { done(eps && eps[e - 1] && eps[e - 1].name || 'Episódio ' + e); });
  }

  // MARK: - Measurements: clicks from Home to the first frame, TTFF, first choice kept, sources menu opened

  var M = {clicks: 0, homeAt: now(), log: [], last: null};
  try { M.log = JSON.parse(localStorage.getItem('sofa.proto.log') || '[]'); } catch (e) { M.log = []; }
  function saveLog() { try { localStorage.setItem('sofa.proto.log', JSON.stringify(M.log.slice(-500))); } catch (e) {} }
  function homeShown() { M.clicks = 0; M.homeAt = now(); }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
  var hudOn = true;
  function hud() {
    var h = $('#hud');
    h.className = !hudOn ? 'off' : state.screen === 'player' ? 'left' : '';
    if (!hudOn) return;
    var lines = [], plays = M.log.filter(function (x) { return x.kind === 'play'; });
    var kept = plays.filter(function (x) { return x.kept !== false; }).length;
    var ttffs = plays.map(function (x) { return x.ttff; }), clicks = plays.map(function (x) { return x.clicks; });
    lines.push(CAPS.device);
    lines.push('Tempos simulados: o player de verdade mede os reais');
    if (M.last) lines.push('Última: <b>' + M.last.clicks + ' cliques</b> · TTFF <b>' + (M.last.ttff / 1000).toFixed(1).replace('.', ',') + ' s</b>' + (M.last.warm ? ' (pré-resolvido)' : ' (frio)'));
    if (plays.length) lines.push('Mediana: ' + median(clicks) + ' cliques · TTFF ' + (median(ttffs) / 1000).toFixed(1).replace('.', ',') + ' s · 1ª escolha ' + Math.round(100 * kept / plays.length) + '% (' + kept + '/' + plays.length + ')');
    lines.push('Cliques desde o Início: ' + M.clicks);
    if (focusId && R[focusId]) {
      var r = R[focusId];
      lines.push('Pré-resolução: ' + esc(TITLES[focusId].title) + ' ' + (r.ready ? '<b>pronta</b> em ' + r.ms + ' ms' : '…'));
      if (r.ready && r.rank.play[0]) lines.push('  → ' + esc(Ranking.label(r.rank.play[0])) + ' (' + r.rank.play.length + ' tocáveis, ' + r.rank.out.length + ' fora)');
    }
    h.innerHTML = lines.join('\n');
  }

  // MARK: - Pre-resolving: when a title keeps focus for a moment, ask AIOStreams and pick the stream, before OK

  var R = {}, focusId = '', resolveTimer = 0;
  function resolve(id, done) {
    var r = R[id];
    if (r && r.ready && now() - r.at < 10 * 60000) { if (done) done(r); return; }
    if (r && !r.ready) { if (done) r.wait.push(done); return; }
    r = R[id] = {ready: false, wait: done ? [done] : [], at: now()};
    var ms = Math.round(rnd(260, 680));       // AIOStreams with a warm cache answers in about this time
    setTimeout(function () {
      r.rank = Ranking.rank(SAMPLE.streams(id), CAPS);
      r.ready = true; r.ms = ms; r.at = now();
      var w = r.wait; r.wait = [];
      for (var i = 0; i < w.length; i++) w[i](r);
      hud();
      if (state.screen === 'detail' && D.id === id) renderPick();
    }, ms);
  }
  function focusTitle(id) {
    focusId = id;
    clearTimeout(resolveTimer);
    resolveTimer = setTimeout(function () { resolve(id); }, 300);
    hud();
  }

  // MARK: - Screens

  var state = {screen: 'home'};
  function show(name) {
    state.screen = name;
    $('#home').className = 'screen' + (name === 'home' ? '' : ' hidden');
    $('#detail').className = 'screen' + (name === 'detail' ? '' : ' hidden');
    $('#player').className = 'screen' + (name === 'player' ? '' : ' hidden');
    hud();
  }

  // MARK: - Home

  var H = {zone: 'hero', page: 0, btn: 0, row: 0, idx: [], rows: [], heroTimer: 0, artLayer: 0};
  var HOME = SAMPLE.home;

  function heroItem() { return HOME.hero[H.page]; }
  function continueOf(id) {
    var c = HOME.rows[0].items;
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  }

  function metaLine(t) {
    var p = [t.type === 'series' ? 'Série' : 'Filme', t.year, t.genres.join(', ')];
    if (t.runtime) p.push(minutes(t.runtime));
    return esc(p.join(' · ')) + '<span class="b">' + esc(t.cert) + '</span>';
  }

  function setLogo(box, t, a) {
    var img = $('img', box);
    $('.name', box).textContent = t.title;
    box.className = 'logo text';
    if (a && a.logo) {
      img.onload = function () { box.className = 'logo has'; };
      img.src = a.logo;
    }
  }

  function renderHero() {
    var h = heroItem(), t = TITLES[h.id];
    var layers = document.querySelectorAll('#hero .art');
    H.artLayer = 1 - H.artLayer;
    var on = layers[H.artLayer], off = layers[1 - H.artLayer];
    on.style.backgroundImage = gradient(t);
    on.style.opacity = 1; off.style.opacity = 0;
    loadArt(h.id, function (a) {
      if (heroItem() !== h) return;
      if (a && a.backdrop) on.style.backgroundImage = 'url("' + a.backdrop + '")';
      setLogo($('#hero .logo'), t, a);
    });
    $('#hero .kicker').textContent = h.kicker;
    setLogo($('#hero .logo'), t, art[h.id]);
    $('#hero .meta').innerHTML = metaLine(t);
    $('#hero .why').textContent = h.why;
    var c = continueOf(h.id), b = $('#hero .buttons');
    b.innerHTML = '';
    var play = el('span', 'btn lift', '<span class="ico">▶</span>' + (c && c.progress ? 'Continuar' + (c.s ? ' T' + c.s + ' E' + c.e : '') : 'Assistir'));
    if (c && c.progress) play.innerHTML += '<span class="bar"><i style="width:' + Math.round(c.progress * 100) + '%"></i></span>';
    b.appendChild(play);
    b.appendChild(el('span', 'btn lift', 'Detalhes'));
    b.appendChild(el('span', 'btn round lift', '+'));
    var d = $('#hero .dots');
    d.innerHTML = '';
    for (var i = 0; i < HOME.hero.length; i++) d.appendChild(el('i', i === H.page ? 'on' : ''));
    paintHome();
  }

  // The hero turns its pages by itself while it has focus and nobody touches the remote (9 s, like the Top Shelf).
  function heroTick() {
    clearTimeout(H.heroTimer);
    H.heroTimer = setTimeout(function () {
      if (state.screen === 'home' && H.zone === 'hero' && !S.open && !sheet.open) {
        H.page = (H.page + 1) % HOME.hero.length; H.btn = 0; renderHero(); focusTitle(heroItem().id);
      }
      heroTick();
    }, 9000);
  }

  var CARD = {continue: 'wide', picks: 'wide', chart: 'chart', poster: 'poster', wide: 'wide'};
  var STEP = {wide: 588, chart: 420, poster: 290, ep: 460, person: 240};

  function card(kind, item, n) {
    var t = TITLES[item.id], cls = CARD[kind] || kind;
    var c = el('div', 'card lift ' + cls);
    var pic = el('div', 'pic');
    pic.style.backgroundImage = gradient(t);
    pic.appendChild(el('div', 't', esc(t.title)));
    if (kind === 'chart') c.appendChild(el('div', 'num', String(n + 1)));
    if (kind === 'continue' && item.progress) {
      pic.className += ' withprog';
      pic.appendChild(el('div', 'prog', '<i style="width:' + Math.round(item.progress * 100) + '%"></i>'));
    }
    c.appendChild(pic);
    var l1 = t.title, l2 = '';
    if (kind === 'continue') {
      if (item.next) l2 = 'Próximo · T' + item.s + ' E' + item.e;
      else if (item.s) l2 = 'T' + item.s + ' · E' + item.e + ' · ' + item.left + ' min restantes';
      else l2 = minutes(item.left) + ' restantes';
    } else if (kind === 'picks') l2 = item.why;
    else if (kind === 'chart' || kind === 'poster') { l1 = ''; }
    else l2 = t.year + ' · ' + t.genres[0];
    if (l1 || l2) c.appendChild(el('div', 'cap', '<div class="l1">' + esc(l1) + '</div><div class="l2">' + esc(l2) + '</div>'));
    loadArt(item.id, function (a) {
      if (!a) return;
      var url = (cls === 'poster' || cls === 'chart') ? a.poster : a.backdrop;
      if (url) { pic.style.backgroundImage = 'url("' + url + '")'; pic.className += ' has'; }
    });
    return c;
  }

  function buildRows() {
    var box = $('#rows');
    box.innerHTML = '';
    H.rows = []; H.idx = [];
    for (var r = 0; r < HOME.rows.length; r++) {
      var row = HOME.rows[r], cls = CARD[row.kind];
      var e = el('div', 'row ' + row.kind + (cls === 'poster' || cls === 'chart' ? ' tall' : ''));
      e.appendChild(el('h2', '', esc(row.title)));
      e.appendChild(el('div', 'sub', esc(row.subtitle || '')));
      var track = el('div', 'track');
      var cards = [];
      for (var i = 0; i < row.items.length; i++) { var c = card(row.kind, row.items[i], i); track.appendChild(c); cards.push(c); }
      e.appendChild(track);
      box.appendChild(e);
      H.rows.push({el: e, track: track, cards: cards, step: STEP[cls]});
      H.idx.push(0);
    }
  }

  var focused = null;
  function setFocus(e) {
    if (focused === e) return;
    if (focused) focused.className = focused.className.replace(/ ?\bfocus\b/g, '');
    focused = e;
    if (e) e.className += ' focus';
  }

  function scrollTrack(row, i) {
    var visible = Math.floor(1760 / row.step);
    var first = Math.max(0, Math.min(i - 1, row.cards.length - visible));
    translate(row.track, -first * row.step, 0);
  }

  function paintHome() {
    if (state.screen !== 'home') return;
    if (H.zone === 'hero') {
      translate($('#page'), 0, 0);
      setFocus($('#hero .buttons').children[H.btn]);
    } else {
      var row = H.rows[H.row];
      translate($('#page'), 0, -(900 + row.el.offsetTop - 110));
      scrollTrack(row, H.idx[H.row]);
      setFocus(row.cards[H.idx[H.row]]);
    }
  }

  function homeItem() {
    if (H.zone === 'hero') return heroItem();
    return HOME.rows[H.row].items[H.idx[H.row]];
  }

  function homeKey(k) {
    if (k === 'up') {
      if (H.zone === 'rows') { if (H.row > 0) H.row--; else H.zone = 'hero'; }
    } else if (k === 'down') {
      if (H.zone === 'hero') { H.zone = 'rows'; H.row = 0; }
      else if (H.row < H.rows.length - 1) H.row++;
    } else if (k === 'left') {
      if (H.zone === 'hero') {
        if (H.btn > 0) H.btn--;
        else { H.page = (H.page + HOME.hero.length - 1) % HOME.hero.length; renderHero(); }
      } else if (H.idx[H.row] > 0) H.idx[H.row]--;
      else { openSide(); return; }
    } else if (k === 'right') {
      if (H.zone === 'hero') {
        if (H.btn < 2) H.btn++;
        else { H.page = (H.page + 1) % HOME.hero.length; H.btn = 0; renderHero(); }
      } else if (H.idx[H.row] < H.rows[H.row].cards.length - 1) H.idx[H.row]++;
    } else if (k === 'ok') {
      var it = homeItem();
      if (H.zone === 'hero' && H.btn === 0) { var c = continueOf(it.id); play(it.id, c || {}); return; }
      if (H.zone === 'hero' && H.btn === 2) { toast('Na sua watchlist do Trakt'); return; }
      if (H.zone === 'rows' && HOME.rows[H.row].kind === 'continue') { play(it.id, it); return; }   // Continue plays right away
      openDetail(it.id, it);
      return;
    } else if (k === 'back') {
      if (H.zone === 'rows') { H.zone = 'hero'; }       // Back from a row scrolls to the top first, like tvOS
      else { openSide(); return; }
    } else if (k === 'menu') {
      openSources(homeItem().id, null, function (s) { play(homeItem().id, continueOf(homeItem().id) || {}, s); });
      return;
    }
    heroTick();
    paintHome();
    focusTitle(homeItem().id);
  }

  // MARK: - Sidebar

  var S = {open: false, i: 1, items: [
    {ico: '⌕', a: 'Buscar'}, {ico: '⌂', a: 'Início', on: true}, {ico: '▭', a: 'Filmes'}, {ico: '▤', a: 'Séries'},
    {ico: '✦', a: 'Curadoria'}, {ico: '♡', a: 'Biblioteca'}, {sep: true},
    {ico: '◷', a: 'Métricas', val: function () { return hudOn ? 'ligadas' : 'desligadas'; }, act: function () { hudOn = !hudOn; hud(); }},
    {ico: '⟲', a: 'Zerar o log', act: function () { M.log = []; M.last = null; saveLog(); hud(); toast('Log do protótipo zerado'); }}
  ]};
  function openSide() { S.open = true; S.i = 1; renderSide(); }
  function closeSide() { S.open = false; $('#side').className = 'hidden'; paintHome(); }
  function renderSide() {
    var p = $('#side .panel');
    p.innerHTML = '<div class="who">Perfil<b>Erick</b></div>';
    var focusEl = null;
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (it.sep) { p.appendChild(el('div', 'sep')); continue; }
      var e = el('div', 'it lift' + (it.on ? ' on' : ''), '<span class="ico">' + it.ico + '</span>' + esc(it.a) +
        (it.val ? '<span class="val">' + esc(it.val()) + '</span>' : ''));
      p.appendChild(e);
      if (i === S.i) focusEl = e;
    }
    $('#side').className = '';
    setFocus(focusEl);
  }
  function sideKey(k) {
    if (k === 'up' || k === 'down') {
      var d = k === 'up' ? -1 : 1, i = S.i + d;
      while (i >= 0 && i < S.items.length && S.items[i].sep) i += d;
      if (i >= 0 && i < S.items.length) S.i = i;
      renderSide();
    } else if (k === 'right' || k === 'back') closeSide();
    else if (k === 'ok') {
      var it = S.items[S.i];
      if (it.act) { it.act(); renderSide(); }
      else if (it.a === 'Início') closeSide();
      else toast('No protótipo, só o Início está montado');
    }
  }

  // MARK: - Details page

  var D = {id: '', zone: 'buttons', btn: 0, row: 0, idx: [], rows: [], season: 1, seasonFocus: 0, stack: [], item: null};

  function openDetail(id, item, keepStack) {
    if (state.screen === 'detail' && !keepStack && D.id) D.stack.push({id: D.id, item: D.item});
    if (state.screen === 'home') D.stack = [];
    var t = TITLES[id];
    D.id = id; D.item = item || {}; D.zone = 'buttons'; D.btn = 0; D.row = 0;
    D.season = (item && item.s) || 1;
    show('detail');
    var bg = $('#detail .art');
    bg.style.backgroundImage = gradient(t);
    loadArt(id, function (a) { if (D.id === id && a && a.backdrop) bg.style.backgroundImage = 'url("' + a.backdrop + '")'; setLogo($('#detail .logo'), t, a); });
    setLogo($('#detail .logo'), t, art[id]);
    $('#detail .meta').innerHTML = metaLine(t);
    $('#detail .desc').textContent = t.desc;
    $('#detail .credits').textContent = t.director ? 'Direção: ' + t.director + ' · Fotografia: ' + t.dop : '';
    var c = continueOf(id) || item || {};
    var b = $('#detail .buttons');
    b.innerHTML = '';
    var label = c.progress ? 'Continuar' + (c.s ? ' T' + c.s + ' E' + c.e : '') : c.next ? 'Assistir T' + c.s + ' E' + c.e : t.type === 'series' ? 'Assistir T1 E1' : 'Assistir';
    var p = el('span', 'btn lift', '<span class="ico">▶</span>' + label);
    if (c.progress) p.innerHTML += '<span class="bar"><i style="width:' + Math.round(c.progress * 100) + '%"></i></span>';
    b.appendChild(p);
    b.appendChild(el('span', 'btn round lift', '+'));
    b.appendChild(el('span', 'btn lift', 'Fontes'));
    b.appendChild(el('span', 'btn round lift', '★'));
    buildDetailRows();
    resolve(id);
    renderPick();
    paintDetail();
    focusTitle(id);
  }

  // What will play on this TV, chosen in advance: the badges and the line under the buttons.
  function renderPick() {
    var r = R[D.id], badges = $('#detail .badges'), pick = $('#detail .pick');
    if (!r || !r.ready) { badges.innerHTML = ''; pick.textContent = 'Escolhendo a melhor fonte pra esta TV…'; return; }
    var s = r.rank.play[0];
    if (!s) { badges.innerHTML = ''; pick.textContent = 'Nenhuma fonte em cache no TorBox que esta TV toque'; return; }
    var bs = [Ranking.resLabel(Math.min(s.res, CAPS.maxHeight))];
    if (s.hdr.indexOf('HDR10') >= 0) bs.push('HDR10');
    bs.push(s.audio[0].replace(/ \d\.\d$/, ''));
    if (s.pt) bs.push('ÁUDIO PT');
    bs.push('LEG PT-BR');
    badges.innerHTML = '<span>' + bs.map(esc).join('</span><span>') + '</span>';
    pick.innerHTML = 'Vai tocar: ' + esc(Ranking.label(s)) + ' · <b>⚡ TorBox</b> · ' + r.rank.play.length + ' fontes tocáveis';
  }

  function buildDetailRows() {
    var t = TITLES[D.id], box = $('#drows');
    box.innerHTML = '';
    D.rows = []; D.idx = [];
    if (t.type === 'series') {
      var tabs = el('div', 'seasons');
      for (var s = 1; s <= t.seasons.length; s++) tabs.appendChild(el('span', s === D.season ? 'on' : '', 'Temporada ' + s));
      box.appendChild(tabs);
      D.tabs = tabs;
      var eps = el('div', 'row');
      eps.appendChild(el('div', 'sub', ''));
      var track = el('div', 'track');
      track.style.top = '10px';
      eps.appendChild(track);
      eps.style.height = '400px';
      box.appendChild(eps);
      D.rows.push({el: eps, track: track, cards: [], step: STEP.ep, kind: 'eps'});
      D.idx.push(D.item && D.item.e ? D.item.e - 1 : 0);
      fillEpisodes();
    }
    var people = [];
    if (t.director) people.push({n: t.director, r: 'Direção'});
    if (t.dop) people.push({n: t.dop, r: 'Fotografia'});
    if (people.length) {
      var pr = el('div', 'row');
      pr.style.height = '380px';
      pr.appendChild(el('h2', '', 'Ficha'));
      pr.appendChild(el('div', 'sub', ''));
      var pt = el('div', 'track'), pc = [];
      for (var i = 0; i < people.length; i++) {
        var initials = people[i].n.split(' ').map(function (w) { return w.charAt(0); }).slice(0, 2).join('');
        var c = el('div', 'card lift person', '<div class="pic">' + esc(initials) + '</div><div class="cap"><div class="l1">' + esc(people[i].n) + '</div><div class="l2">' + people[i].r + '</div></div>');
        pt.appendChild(c); pc.push(c);
      }
      pr.appendChild(pt); box.appendChild(pr);
      D.rows.push({el: pr, track: pt, cards: pc, step: STEP.person, kind: 'people'});
      D.idx.push(0);
    }
    var rel = [], g = t.genres[0];
    for (var id in TITLES) if (id !== D.id && TITLES[id].genres.indexOf(g) >= 0 && rel.length < 8) rel.push({id: id});
    if (rel.length) {
      var rr = el('div', 'row');
      rr.appendChild(el('h2', '', 'Relacionados'));
      rr.appendChild(el('div', 'sub', ''));
      var rt = el('div', 'track'), rc = [];
      for (var j = 0; j < rel.length; j++) { var cc = card('wide', rel[j], j); rt.appendChild(cc); rc.push(cc); }
      rr.appendChild(rt); box.appendChild(rr);
      D.rows.push({el: rr, track: rt, cards: rc, step: STEP.wide, kind: 'related', items: rel});
      D.idx.push(0);
    }
  }

  function fillEpisodes() {
    var t = TITLES[D.id], row = D.rows[0], n = t.seasons[D.season - 1], id = D.id, season = D.season;
    row.track.innerHTML = '';
    row.cards = [];
    for (var e = 1; e <= n; e++) {
      var c = el('div', 'card lift ep', '<div class="pic"><div class="t">' + e + '</div></div><div class="cap"><div class="l1">' + e + '. Episódio ' + e + '</div><div class="l2"></div></div>');
      $('.pic', c).style.backgroundImage = gradient(t);
      row.track.appendChild(c); row.cards.push(c);
    }
    if (D.idx[0] >= n) D.idx[0] = 0;
    loadSeason(id, season, function (eps) {
      if (!eps || D.id !== id || D.season !== season) return;
      for (var i = 0; i < row.cards.length && i < eps.length; i++) {
        $('.l1', row.cards[i]).textContent = (i + 1) + '. ' + eps[i].name;
        $('.l2', row.cards[i]).textContent = eps[i].runtime ? eps[i].runtime + ' min' : '';
        if (eps[i].still) { var p = $('.pic', row.cards[i]); p.style.backgroundImage = 'url("' + eps[i].still + '")'; p.className += ' has'; }
      }
    });
  }

  function paintDetail() {
    var t = TITLES[D.id];
    if (D.tabs) {
      var spans = D.tabs.children;
      for (var i = 0; i < spans.length; i++) spans[i].className = (i + 1 === D.season ? 'on' : '');
    }
    if (D.zone === 'buttons') {
      translate($('#dpage'), 0, 0);
      setFocus($('#detail .buttons').children[D.btn]);
    } else if (D.zone === 'seasons') {
      translate($('#dpage'), 0, -760);
      setFocus(null);
      D.tabs.children[D.season - 1].className = 'focus';
    } else {
      var row = D.rows[D.row];
      var top = 1080 + row.el.offsetTop - (t.type === 'series' && D.row === 0 ? 240 : 170);
      translate($('#dpage'), 0, -top);
      scrollTrack(row, D.idx[D.row]);
      setFocus(row.cards[D.idx[D.row]]);
    }
  }

  function detailKey(k) {
    var t = TITLES[D.id], series = t.type === 'series';
    if (k === 'back') {
      var prev = D.stack.pop();
      if (prev) { openDetail(prev.id, prev.item, true); return; }
      show('home'); homeShown(); paintHome(); focusTitle(homeItem().id); hud(); return;
    }
    if (k === 'menu') { openSources(D.id, null, function (s) { play(D.id, D.item, s); }); return; }
    if (D.zone === 'buttons') {
      if (k === 'left' && D.btn > 0) D.btn--;
      else if (k === 'right' && D.btn < 3) D.btn++;
      else if (k === 'down' && D.rows.length) { D.zone = series ? 'seasons' : 'rows'; D.row = 0; }
      else if (k === 'ok') {
        if (D.btn === 0) {
          var c = continueOf(D.id) || D.item || {};
          play(D.id, series ? {s: c.s || 1, e: c.e || 1, progress: c.progress || 0} : c);
          return;
        }
        if (D.btn === 1) toast('Na sua watchlist do Trakt');
        if (D.btn === 2) openSources(D.id, null, function (s) { play(D.id, continueOf(D.id) || D.item || {}, s); });
        if (D.btn === 3) toast('Nota enviada pro Trakt e pro Letterboxd (no app de verdade)');
        return;
      }
    } else if (D.zone === 'seasons') {
      if (k === 'left' && D.season > 1) { D.season--; fillEpisodes(); }
      else if (k === 'right' && D.season < t.seasons.length) { D.season++; fillEpisodes(); }
      else if (k === 'up') D.zone = 'buttons';
      else if (k === 'down' || k === 'ok') { D.zone = 'rows'; D.row = 0; }
    } else {
      var row = D.rows[D.row];
      if (k === 'left' && D.idx[D.row] > 0) D.idx[D.row]--;
      else if (k === 'right' && D.idx[D.row] < row.cards.length - 1) D.idx[D.row]++;
      else if (k === 'up') { if (D.row > 0) D.row--; else D.zone = series ? 'seasons' : 'buttons'; }
      else if (k === 'down' && D.row < D.rows.length - 1) D.row++;
      else if (k === 'ok') {
        if (row.kind === 'eps') { play(D.id, {s: D.season, e: D.idx[0] + 1, progress: 0}); return; }
        if (row.kind === 'related') { openDetail(row.items[D.idx[D.row]].id, {}); return; }
      }
    }
    paintDetail();
  }

  // MARK: - Menus: sources, subtitles, audio

  var sheet = {open: false, items: [], i: 0, close: null};
  function openSheet(title, items, onClose) {
    sheet.open = true; sheet.items = items; sheet.close = onClose || null;
    sheet.i = 0;
    for (var i = 0; i < items.length; i++) if (!items[i].head) { sheet.i = i; break; }
    for (i = 0; i < items.length; i++) if (items[i].chk && !items[i].head) { sheet.i = i; break; }
    $('#sheet h3').textContent = title;
    $('#sheet').className = '';
    renderSheet();
  }
  function closeSheet() {
    sheet.open = false;
    $('#sheet').className = 'hidden';
    if (sheet.close) sheet.close();
    repaint();
  }
  function renderSheet() {
    var list = $('#sheet .list'), focusEl = null;
    list.innerHTML = '';
    for (var i = 0; i < sheet.items.length; i++) {
      var it = sheet.items[i];
      if (it.head) { list.appendChild(el('div', 'head', esc(it.head))); continue; }
      var e = el('div', 'opt' + (it.off ? ' off' : ''),
        '<span class="chk">' + (it.chk ? '✓' : '') + '</span><div class="a">' + esc(it.a) + (it.tag ? '<span class="tag">' + esc(it.tag) + '</span>' : '') + '</div>' +
        (it.b ? '<div class="b">' + esc(it.b) + '</div>' : ''));
      list.appendChild(e);
      if (i === sheet.i) focusEl = e;
    }
    setFocus(focusEl);
    // Keep the focused option in view.
    var y = focusEl ? focusEl.offsetTop : 0;
    translate(list, 0, -Math.max(0, y - 600));
  }
  function sheetKey(k) {
    if (k === 'up' || k === 'down') {
      var d = k === 'up' ? -1 : 1, i = sheet.i + d;
      while (i >= 0 && i < sheet.items.length && sheet.items[i].head) i += d;
      if (i >= 0 && i < sheet.items.length) { sheet.i = i; renderSheet(); }
    } else if (k === 'back' || k === 'menu') closeSheet();
    else if (k === 'ok') {
      var it = sheet.items[sheet.i];
      if (it.act) it.act(it);
    }
  }

  function sourceItems(id, current, pick) {
    var r = R[id], items = [{head: 'Tocáveis nesta TV · melhor primeiro'}];
    for (var i = 0; i < r.rank.play.length; i++) {
      var s = r.rank.play[i];
      items.push({a: Ranking.label(s), tag: i === 0 ? 'AUTO' : '', chk: s === current,
        b: s.source + ' · ' + s.codec + ' · ' + String(s.mbps).replace('.', ',') + ' Mbps · ' + s.group + (s.pt ? ' · áudio PT' : '') +
           (Ranking.audioKind(s.audio[0]) === 'DTS' || Ranking.audioKind(s.audio[0]) === 'TrueHD' ? ' · áudio decodificado no app' : '') + ' · ⚡ TorBox',
        stream: s, act: function (it) { closeSheet(); pick(it.stream); }});
    }
    if (r.rank.out.length) {
      items.push({head: 'Fora · esta TV não toca bem'});
      for (i = 0; i < r.rank.out.length; i++) {
        var o = r.rank.out[i];
        items.push({a: Ranking.label(o.stream), off: true, b: o.why, act: function (it) { toast(it.b); }});
      }
    }
    return items;
  }

  function openSources(id, current, pick) {
    M.log.push({kind: 'menu', at: now(), id: id}); saveLog();
    resolve(id, function () { openSheet('Fontes', sourceItems(id, current, pick)); });
  }

  // MARK: - Player (simulated video, real flow around it)

  var P = {id: '', t: null, s: 0, e: 0, pos: 0, dur: 0, paused: false, stream: null, list: [], zone: 'bar', pill: 0,
           osdTimer: 0, tick: 0, started: false, failedOnce: false, subs: 1, audio: 0, nextCount: 0, rec: null, tabs: false, tab: 0};

  function play(id, from, chosen) {
    var t = TITLES[id], t0 = now(), clicks = M.clicks, warm = R[id] && R[id].ready;
    P.id = id; P.t = t; P.s = from && from.s || (t.type === 'series' ? 1 : 0); P.e = from && from.e || (t.type === 'series' ? 1 : 0);
    P.dur = (t.type === 'series' ? 50 : t.runtime) * 60;
    P.pos = from && from.progress ? from.progress * P.dur : 0;      // resume without asking (HIG: playing video)
    if (t.type === 'series' && !P.pos) P.pos = 30;                  // so skip intro shows up soon in the demo
    P.paused = false; P.started = false; P.zone = 'bar'; P.pill = 0; P.tabs = false; P.nextCount = 0;
    show('player');
    $('#player .frame').className = 'frame';
    $('#player .skip').className = 'skip';
    $('#player .next').className = 'next';
    $('#player .tabs').className = 'tabs';
    osd(false);
    setFocus(null);
    var spin = setTimeout(function () { $('#player .spinner').className = 'spinner on'; }, 2000);   // only after 2 s (HIG)
    resolve(id, function (r) {
      P.list = r.rank.play.slice();
      P.stream = chosen || P.list[0];
      P.rec = {kind: 'play', at: t0, id: id, clicks: clicks, warm: !!warm, manual: !!chosen, kept: !chosen, fallbacks: 0, ttff: 0};
      // The time to open the link and fill the buffer: Media3 on the stick with a TorBox link, from the AIOStreams
      // answer on. Bigger files take a little longer to start.
      var open = rnd(700, 1100) + P.stream.mbps * 18;
      setTimeout(function () {
        if (state.screen !== 'player' || P.id !== id) return;
        clearTimeout(spin);
        $('#player .spinner').className = 'spinner';
        firstFrame();
      }, open);
    });
    episodeLabel();
  }

  function firstFrame() {
    var f = $('#player .frame');
    f.style.backgroundImage = gradient(P.t);
    loadArt(P.id, function (a) { if (a && a.backdrop) f.style.backgroundImage = 'url("' + a.backdrop + '")'; });
    f.className = 'frame on';
    P.started = true;
    P.rec.ttff = now() - P.rec.at;
    M.last = P.rec;
    M.log.push(P.rec); saveLog();
    hud();
    clearInterval(P.tick);
    P.tick = setInterval(tick, 250);
    renderOsd();
  }

  function episodeLabel() {
    var k = $('#player .osd .kicker'), n = $('#player .osd .name');
    if (P.s) {
      k.textContent = P.t.title + ' · T' + P.s + ' E' + P.e;
      n.textContent = 'Episódio ' + P.e;
      var id = P.id, s = P.s, e = P.e;
      episodeName(id, s, e, function (name) { if (P.id === id && P.s === s && P.e === e) n.textContent = name; });
    } else { k.textContent = P.t.year + ' · ' + minutes(P.t.runtime); n.textContent = P.t.title; }
  }

  function tick() {
    if (state.screen !== 'player' || !P.started) return;
    if (!P.paused) P.pos += 0.25;
    // A stream that breaks: Media3 reports the error (or the buffer stalls for 6 s); the next stream takes over at
    // the same position, without the person doing anything.
    if (P.stream && P.stream.fails && !P.failedOnce && P.pos > 0 && now() - P.rec.at > P.rec.ttff + 4000) {
      P.failedOnce = true; P.started = false;
      $('#player .spinner').className = 'spinner on';
      setTimeout(function () {
        var i = P.list.indexOf(P.stream), next = P.list[i + 1] || P.list[0];
        P.stream = next;
        P.rec.kept = false; P.rec.fallbacks++; saveLog();
        $('#player .spinner').className = 'spinner';
        P.started = true;
        toast('A fonte travou. Troquei pra ' + Ranking.label(next));
        hud();
      }, 1400);
    }
    var skip = $('#player .skip');
    var inIntro = P.s && P.pos >= 40 && P.pos < 100;
    if (inIntro && skip.className.indexOf('on') < 0) { skip.className = 'skip on'; skip.innerHTML = '<span class="btn lift">Pular abertura</span>'; }
    if (!inIntro && skip.className.indexOf('on') >= 0) skip.className = 'skip';
    var left = P.dur - P.pos, next = $('#player .next');
    if (P.s && left <= 20 && hasNext()) {
      if (next.className.indexOf('on') < 0) showNext();
      $('.count', next).textContent = 'Começa em ' + Math.ceil(left - 5) + ' s · mesma fonte';
      if (left <= 5) nextEpisode();
    } else if (!P.s && left <= 0) { stopPlayer(); return; }
    renderOsd();
  }

  function hasNext() { return P.e < P.t.seasons[P.s - 1] || P.s < P.t.seasons.length; }
  function showNext() {
    var n = $('#player .next'), s = P.s, e = P.e + 1;
    if (e > P.t.seasons[s - 1]) { s++; e = 1; }
    n.className = 'next on';
    $('.ep', n).textContent = 'T' + s + ' E' + e;
    episodeName(P.id, s, e, function (name) { $('.ep', n).textContent = 'T' + s + ' E' + e + ' · ' + name; });
    $('.thumb', n).style.backgroundImage = gradient(P.t);
    loadSeason(P.id, s, function (eps) { if (eps && eps[e - 1] && eps[e - 1].still) $('.thumb', n).style.backgroundImage = 'url("' + eps[e - 1].still + '")'; });
    if (!$('#player .osd').className.match(/\bon\b/)) setFocus(n);
  }
  // The next episode keeps the stream's bingeGroup (same release group and quality), so it starts as fast.
  function nextEpisode() {
    var s = P.s, e = P.e + 1;
    if (e > P.t.seasons[s - 1]) { s++; e = 1; }
    P.s = s; P.e = e; P.pos = 0; P.failedOnce = false;
    $('#player .next').className = 'next';
    setFocus(null);
    episodeLabel();
    toast('T' + s + ' E' + e + ' · mesma fonte (' + P.stream.group + ')');
  }

  function osd(on) {
    var o = $('#player .osd');
    o.className = 'osd' + (on ? ' on' : '');
    clearTimeout(P.osdTimer);
    if (on && !P.paused) P.osdTimer = setTimeout(function () { if (!sheet.open && !P.tabs) { osd(false); repaint(); } }, 4500);
  }
  function osdOn() { return /\bon\b/.test($('#player .osd').className); }

  function renderOsd() {
    if (state.screen !== 'player') return;
    var pct = P.dur ? Math.min(1, P.pos / P.dur) : 0;
    $('#player .bar .fill').style.width = (pct * 100) + '%';
    $('#player .bar .head').style.left = (pct * 100) + '%';
    $('#player .times .at').textContent = clock(P.pos) + (P.paused ? '  ❚❚' : '');
    $('#player .times .left').textContent = '-' + clock(P.dur - P.pos);
    var pills = $('#player .pills');
    if (!pills.children.length) {
      pills.appendChild(el('span', 'btn lift', 'Legendas'));
      pills.appendChild(el('span', 'btn lift', 'Áudio'));
      pills.appendChild(el('span', 'btn lift', 'Fontes'));
    }
  }

  function paintPlayer() {
    var bar = $('#player .bar');
    bar.className = 'bar';
    if (sheet.open) return;
    if (P.tabs) return paintTabs();
    if (!osdOn()) {
      var skip = $('#player .skip'), next = $('#player .next');
      if (/\bon\b/.test(next.className)) setFocus(next);
      else if (/\bon\b/.test(skip.className)) setFocus(skip.firstChild);
      else setFocus(null);
      return;
    }
    if (P.zone === 'bar') { setFocus(null); bar.className = 'bar focus'; }
    else setFocus($('#player .pills').children[P.pill]);
  }

  function subsItems() {
    // Priority pt-BR > pt > en; inside each language, the subtitle made for this release (same file hash or
    // name, from AIOStreams and OpenSubtitles) comes first, because it's in sync.
    var g = P.stream.group, list = [
      {a: 'Desligadas'},
      {a: 'Português (Brasil)', b: 'Mesmo release (' + g + ') · em sincronia · OpenSubtitles', tag: 'AUTO'},
      {a: 'Português (Brasil)', b: 'Outro release · pode estar fora de sincronia'},
      {a: 'Português', b: 'Mesmo release (' + g + ')'},
      {a: 'English', b: 'Mesmo release (' + g + ')'},
      {a: 'English SDH', b: 'Outro release'}
    ];
    for (var i = 0; i < list.length; i++) {
      list[i].chk = i === P.subs;
      list[i].act = (function (n) { return function () { P.subs = n; closeSheet(); toast(n ? 'Legendas: ' + list[n].a : 'Legendas desligadas'); }; })(i);
    }
    return list;
  }
  function audioItems() {
    var list = [], tracks = P.stream.audio.slice();
    if (P.stream.pt) tracks.push('Português · DD 5.1');
    for (var i = 0; i < tracks.length; i++) {
      var soft = /DTS|TrueHD/.test(tracks[i]);
      list.push({a: tracks[i], b: (soft ? 'Decodificado no app, sai em estéreo' : 'Decodificado pelo stick, sai em estéreo PCM'),
        chk: i === P.audio, act: (function (n) { return function () { P.audio = n; closeSheet(); }; })(i)});
    }
    return list;
  }

  function playerKey(k) {
    if (!P.started && k !== 'back') return;
    if (P.tabs) return tabsKey(k);
    var next = $('#player .next'), skip = $('#player .skip');
    if (k === 'menu') { openPlayerSources(); return; }
    if (k === 'playpause') { P.paused = !P.paused; osd(true); renderOsd(); paintPlayer(); return; }
    if (k === 'ff' || k === 'rw') { P.pos = Math.max(0, Math.min(P.dur - 25, P.pos + (k === 'ff' ? 300 : -300))); osd(true); renderOsd(); paintPlayer(); return; }
    if (k === 'back') {
      if (osdOn()) { osd(false); paintPlayer(); return; }
      stopPlayer(); return;
    }
    if (!osdOn()) {
      if (k === 'ok' && /\bon\b/.test(next.className)) { nextEpisode(); return; }
      if (k === 'ok' && /\bon\b/.test(skip.className)) { P.pos = 100; skip.className = 'skip'; renderOsd(); paintPlayer(); return; }
      if (k === 'ok') { P.paused = !P.paused; }
      else if (k === 'left' || k === 'right') { P.pos = Math.max(0, Math.min(P.dur, P.pos + (k === 'left' ? -10 : 10))); }
      else if (k === 'down') { openTabs(); return; }
      P.zone = k === 'up' ? 'pills' : 'bar';
      osd(true); renderOsd(); paintPlayer();
      return;
    }
    if (P.zone === 'bar') {
      if (k === 'left' || k === 'right') P.pos = Math.max(0, Math.min(P.dur, P.pos + (k === 'left' ? -10 : 10)));
      else if (k === 'ok') P.paused = !P.paused;
      else if (k === 'up') P.zone = 'pills';
      else if (k === 'down') { osd(false); openTabs(); return; }
    } else {
      if (k === 'left' && P.pill > 0) P.pill--;
      else if (k === 'right' && P.pill < 2) P.pill++;
      else if (k === 'down') P.zone = 'bar';
      else if (k === 'ok') {
        if (P.pill === 0) openSheet('Legendas', subsItems());
        else if (P.pill === 1) openSheet('Áudio', audioItems());
        else openPlayerSources();
        return;
      }
    }
    osd(true); renderOsd(); paintPlayer();
  }

  function openPlayerSources() {
    osd(true);
    openSources(P.id, P.stream, function (s) {
      if (s === P.stream) return;
      // Changing the stream in the first two minutes means the automatic choice was wrong.
      if (P.rec && now() - P.rec.at < 120000) { P.rec.kept = false; saveLog(); hud(); }
      P.stream = s; P.failedOnce = false;
      P.started = false;
      $('#player .spinner').className = 'spinner on';
      setTimeout(function () { $('#player .spinner').className = 'spinner'; P.started = true; toast('Tocando ' + Ranking.label(s)); }, rnd(700, 1200));
    });
  }

  // Swipe-down tabs (tvOS: Info; for shows, Episodes too).
  function openTabs() {
    P.tabs = true; P.tab = 0;
    $('#player .tabs').className = 'tabs on';
    paintTabs();
  }
  function paintTabs() {
    var names = P.s ? ['Info', 'Episódios'] : ['Info'], heads = $('#player .tabs .heads'), body = $('#player .tabs .body');
    heads.innerHTML = '';
    for (var i = 0; i < names.length; i++) heads.appendChild(el('span', i === P.tab ? 'focus' : '', names[i]));
    setFocus(null);
    if (P.tab === 0) {
      body.innerHTML = '<div class="t1">' + esc(P.t.title) + (P.s ? ' · T' + P.s + ' E' + P.e : '') + '</div><div class="t2">' + esc(P.t.desc) + '</div>' +
        '<div style="margin-top:18px;font-size:22px;color:rgba(255,255,255,.55)">Fonte: ' + esc(Ranking.label(P.stream)) + ' · ' + esc(P.stream.group) + ' · ⚡ TorBox</div>';
    } else {
      var n = P.t.seasons[P.s - 1], h = '<div class="track">';
      for (var e = 1; e <= n; e++) h += '<span style="display:inline-block;margin-right:16px;padding:10px 20px;border-radius:12px;background:' + (e === P.e ? '#fff;color:#000' : 'rgba(255,255,255,.12)') + '">E' + e + '</span>';
      body.innerHTML = h + '</div>';
    }
  }
  function tabsKey(k) {
    var max = P.s ? 1 : 0;
    if (k === 'left' && P.tab > 0) P.tab--;
    else if (k === 'right' && P.tab < max) P.tab++;
    else if (k === 'up' || k === 'back') { P.tabs = false; $('#player .tabs').className = 'tabs'; paintPlayer(); return; }
    paintTabs();
  }

  // Leaving playback opens the title's page (HIG), where Continue now carries the new position.
  function stopPlayer() {
    clearInterval(P.tick);
    P.started = false;
    var c = continueOf(P.id);
    if (c) { c.progress = P.pos / P.dur; c.left = Math.round((P.dur - P.pos) / 60); if (P.s) { c.s = P.s; c.e = P.e; } }
    if (state.screen === 'player') {
      if (D.id !== P.id) D.stack = [];       // played straight from Home: Back on the page goes Home
      openDetail(P.id, c || (D.id === P.id ? D.item : {}), true);
    }
    renderHero();
  }

  // MARK: - Keys (browser keyboard, the Fire TV's remote through the WebView, Samsung and LG remotes)

  function repaint() {
    if (sheet.open) return renderSheet();
    if (S.open) return renderSide();
    if (state.screen === 'home') paintHome();
    else if (state.screen === 'detail') paintDetail();
    else paintPlayer();
  }

  function key(k) {
    M.clicks++;
    if (sheet.open) sheetKey(k);
    else if (S.open) sideKey(k);
    else if (state.screen === 'home') homeKey(k);
    else if (state.screen === 'detail') detailKey(k);
    else playerKey(k);
    hud();
  }

  // In a browser: arrows, Enter, Esc or Backspace, M (Menu), P (play/pause), F and R (forward, rewind).
  // The Fire TV's Menu and media keys come through FreeMyTV.key().
  var CODES = {37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 8: 'back', 27: 'back', 461: 'back', 10009: 'back',
               77: 'menu', 93: 'menu', 179: 'playpause', 80: 'playpause', 415: 'playpause', 19: 'playpause', 10252: 'playpause',
               228: 'ff', 417: 'ff', 70: 'ff', 227: 'rw', 412: 'rw', 82: 'rw'};
  document.addEventListener('keydown', function (e) {
    var k = CODES[e.keyCode];
    if (!k) return;
    e.preventDefault();
    key(k);
  });

  // The Fire TV app (firetv/) calls these: Back, and the keys the WebView doesn't pass on (Menu, media keys).
  window.FreeMyTV = {back: function () { key('back'); }, key: key, reopened: function () {}};

  // MARK: - Start

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080), st = $('#stage');
    st.style.webkitTransform = st.style.transform = 'scale(' + s + ')';
    st.style.left = Math.max(0, (window.innerWidth - 1920 * s) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
  buildRows();
  renderHero();
  heroTick();
  focusTitle(heroItem().id);
  hud();
  if (!CFG.tmdbKey) setTimeout(function () { toast('Sem chave do TMDB: as artes são gradientes. Com ela, backdrops e logos de verdade.'); }, 600);
})();
