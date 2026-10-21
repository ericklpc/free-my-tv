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
  function get(url, done, ms) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = ms || 10000;
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
    if (!CFG.tmdbKey || !t.tmdb) { done(t.art || null); return; }
    if (waiting[id]) { waiting[id].push(done); return; }
    waiting[id] = [done];
    var kind = t.type === 'series' ? 'tv' : 'movie';
    get('https://api.themoviedb.org/3/' + kind + '/' + t.tmdb + '?api_key=' + encodeURIComponent(CFG.tmdbKey) +
        '&language=pt-BR&append_to_response=images&include_image_language=pt,en,null', function (o) {
      var own = t.art || {};
      var a = {backdrop: own.backdrop || '', logo: own.logo || '', poster: own.poster || '', seasons: {}};
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
        if (o.seasons) t.seasons = o.seasons.filter(function (x) { return x.season_number > 0 && x.episode_count; })
          .map(function (x) { return x.episode_count; });
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
  var hudOn = false;
  try { hudOn = localStorage.getItem('sofa.proto.hud') === '1'; } catch (e) {}
  function hud() {
    var h = $('#hud');
    h.className = !hudOn || sheet.open || P.tabs ? 'off' : state.screen === 'player' ? 'left' : '';
    if (!hudOn) return;
    var lines = [], plays = M.log.filter(function (x) { return x.kind === 'play'; });
    var kept = plays.filter(function (x) { return x.kept !== false; }).length;
    var ttffs = plays.map(function (x) { return x.ttff; }), clicks = plays.map(function (x) { return x.clicks; });
    lines.push(CAPS.device);
    lines.push('Tempos simulados: o player de verdade mede os reais');
    if (M.last) lines.push('Última: <b>' + M.last.clicks + ' cliques</b> · TTFF <b>' + (M.last.ttff / 1000).toFixed(1).replace('.', ',') + ' s</b>' + (M.last.warm ? ' (pré-resolvido)' : ' (frio)'));
    if (plays.length) lines.push('Mediana: ' + median(clicks) + ' cliques · TTFF ' + (median(ttffs) / 1000).toFixed(1).replace('.', ',') + ' s · 1ª escolha ' + Math.round(100 * kept / plays.length) + '% (' + kept + '/' + plays.length + ')');
    lines.push('Cliques desde o Início: ' + M.clicks);
    if (focusId && picked(focusId)) {
      var r = picked(focusId);
      lines.push('Pré-resolução: ' + esc(TITLES[focusId].title) + ' ' + (r.ready ? '<b>pronta</b> em ' + r.ms + ' ms' : '…'));
      if (r.ready && r.rank.play[0]) lines.push('  → ' + esc(Ranking.label(r.rank.play[0])) + ' (' + r.rank.play.length + ' tocáveis, ' + r.rank.out.length + ' fora)');
    }
    h.innerHTML = lines.join('\n');
  }

  // MARK: - Pre-resolving: when a title keeps focus for a moment, ask AIOStreams and pick the stream, before OK

  // Real mode: the Fire TV app with the native player (window.Player) and Erick's AIOStreams link in the build.
  // Otherwise the streams are the sample ones and playback is simulated.
  // The manifest link or the configure page's: both work.
  var AIO = (CFG.aioUrl || '').trim().replace(/\/$/, '').replace(/\/(manifest\.json|configure)$/, '');
  var REAL = !!(window.Player && AIO);

  // The id AIOStreams knows: IMDb, or tmdb:<n>; episodes add :season:episode.
  function videoId(id, s, e) {
    var base = id.replace(/^tmdb:tv:/, 'tmdb:');
    return s ? base + ':' + s + ':' + e : base;
  }
  // The episode a show's pre-resolving aims at: where Continue is, or the first.
  function defaultEp(id) {
    if (TITLES[id].type !== 'series') return {};
    var c = continueOf(id);
    return c && c.s ? {s: c.s, e: c.e} : {s: 1, e: 1};
  }

  var R = {}, focusId = '', resolveTimer = 0;
  function resolve(id, done, s, e) {
    if (TITLES[id].type === 'series' && !s) { var d = defaultEp(id); s = d.s; e = d.e; }
    var key = videoId(id, s, e), r = R[key];
    if (r && r.ready && now() - r.at < (r.error ? 30000 : 10 * 60000)) { if (done) done(r); return; }
    if (r && !r.ready) { if (done) r.wait.push(done); return; }
    r = R[key] = {ready: false, wait: done ? [done] : [], at: now()};
    function ready(list, error) {
      r.rank = Ranking.rank(list, caps());
      r.error = error || '';
      if (REAL) console.log('[streams] ' + key + ': ' + (error || list.length + ' fontes, ' + r.rank.play.length + ' tocam') +
        (r.rank.out.length ? ' · fora: ' + r.rank.out.slice(0, 4).map(function (o) { return o.why; }).join(' | ') : '') +
        ' · ' + (now() - r.at) + ' ms');
      r.ready = true; r.ms = now() - r.at; r.at = now();
      // Ask the debrid for the best link now, so OK starts on a resolved address.
      if (REAL && r.rank.play[0]) {
        window.Player.warm(r.rank.play[0].url);
        loadSubs(r.rank.play[0], id, s, e);
      }
      var w = r.wait; r.wait = [];
      for (var i = 0; i < w.length; i++) w[i](r);
      hud();
      if (state.screen === 'detail' && D.id === id) renderPick();
    }
    if (REAL) {
      // The debrid scrapers behind AIOStreams look titles up by IMDb id: TMDB's lists get theirs first.
      imdbId(id, function (imdb) {
        if (!imdb) { ready([], 'sem id do IMDb'); return; }
        var vid = s ? imdb + ':' + s + ':' + e : imdb;
        // A title nobody asked for in a while: AIOStreams asks every scraper and the debrid, which can take 20 s.
        get(AIO + '/stream/' + (TITLES[id].type === 'series' ? 'series' : 'movie') + '/' + vid + '.json', function (o) {
          if (!o) { ready([], 'o AIOStreams não respondeu'); return; }
          var list = (o.streams || []).filter(function (x) { return x.url; });
          ready(list.map(Ranking.parse), list.length ? '' : 'o AIOStreams não achou nenhuma fonte');
        }, 40000);
      });
    } else setTimeout(function () { ready(SAMPLE.streams(id)); }, Math.round(rnd(260, 680)));   // AIOStreams with a warm cache
  }
  function imdbId(id, done) {
    var t = TITLES[id];
    if (/^tt\d+$/.test(id)) { done(id); return; }
    if (t.imdb) { done(t.imdb); return; }
    if (!t.tmdb || !CFG.tmdbKey) { done(''); return; }
    get('https://api.themoviedb.org/3/' + (t.type === 'series' ? 'tv' : 'movie') + '/' + t.tmdb + '/external_ids?api_key=' +
        encodeURIComponent(CFG.tmdbKey), function (o) {
      t.imdb = o && o.imdb_id || '';
      done(t.imdb);
    });
  }
  function picked(id) {
    var d = defaultEp(id);
    return R[videoId(id, d.s, d.e)];
  }
  function focusTitle(id) {
    focusId = id;
    clearTimeout(resolveTimer);
    // Where OK plays right away (the hero's Play, Continue watching), the stream is also prepared after a short stay.
    resolveTimer = setTimeout(function () {
      resolve(id, function () {
        setTimeout(function () {
          var direct = state.screen === 'home' && (H.zone === 'hero' || (HOME.rows[H.row] && HOME.rows[H.row].kind === 'continue'));
          if (focusId === id && direct && !S.open && !sheet.open) preload(id, continueOf(id) || {});
        }, 900);
      });
    }, 300);
    hud();
  }

  // MARK: - Screens

  var state = {screen: 'home'};
  function show(name) {
    if (name === 'home') unpreload();
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
    return esc(p.join(' · ')) + (t.cert ? '<span class="b">' + esc(t.cert) + '</span>' : '');
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

  // MARK: - Dynamic lists: Stremio's own catalogs (Cinemeta, IMDb-based), TMDB's charts for Brazil, and the
  // catalogs of the addons installed in Erick's Stremio account (Trakt, Letterboxd, the TorBox library)

  var CINEMETA = 'https://v3-cinemeta.strem.io';
  var TMDB_GENRES = {28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário', 18: 'Drama',
    10751: 'Família', 14: 'Fantasia', 36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério', 10749: 'Romance',
    878: 'Ficção científica', 53: 'Suspense', 10752: 'Guerra', 37: 'Faroeste', 10759: 'Ação', 10765: 'Ficção científica',
    10768: 'Guerra', 10764: 'Reality', 10767: 'Entrevistas', 10766: 'Novela', 10762: 'Infantil'};
  var EN_GENRES = {'Action': 'Ação', 'Adventure': 'Aventura', 'Animation': 'Animação', 'Biography': 'Biografia', 'Comedy': 'Comédia',
    'Crime': 'Crime', 'Documentary': 'Documentário', 'Drama': 'Drama', 'Family': 'Família', 'Fantasy': 'Fantasia',
    'History': 'História', 'Horror': 'Terror', 'Music': 'Música', 'Musical': 'Musical', 'Mystery': 'Mistério',
    'Romance': 'Romance', 'Sci-Fi': 'Ficção científica', 'Sport': 'Esporte', 'Thriller': 'Suspense', 'War': 'Guerra', 'Western': 'Faroeste'};

  function colorsFor(id) {
    var n = 0;
    for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 360;
    return ['hsl(' + n + ',35%,24%)', 'hsl(' + n + ',35%,7%)'];
  }
  function byTmdb(n) {
    for (var id in TITLES) if (TITLES[id].tmdb === n) return id;
    return '';
  }
  function fromTmdb(o, type) {
    var kind = o.media_type || type, series = kind === 'tv';
    var id = byTmdb(o.id) || 'tmdb:' + (series ? 'tv:' : '') + o.id;
    if (!TITLES[id]) TITLES[id] = {id: id, tmdb: o.id, type: series ? 'series' : 'movie', title: o.title || o.name,
      year: +((o.release_date || o.first_air_date || '').slice(0, 4)) || '',
      genres: (o.genre_ids || []).map(function (g) { return TMDB_GENRES[g]; }).filter(Boolean).slice(0, 2),
      rating: o.vote_average ? o.vote_average.toFixed(1).replace('.', ',') : '', cert: '', colors: colorsFor(id),
      desc: o.overview || '', art: {backdrop: o.backdrop_path ? IMG + 'w1280' + o.backdrop_path : '', poster: o.poster_path ? IMG + 'w342' + o.poster_path : ''}};
    return {id: id};
  }
  function fromCinemeta(m, type) {
    var id = m.imdb_id || m.id;
    if (!TITLES[id]) TITLES[id] = {id: id, type: type, title: m.name, year: parseInt(m.releaseInfo || m.year, 10) || '',
      genres: (m.genres || []).map(function (g) { return EN_GENRES[g] || g; }).slice(0, 2), rating: m.imdbRating || '',
      runtime: parseInt(m.runtime, 10) || 0, cert: '', colors: colorsFor(id), desc: m.description || '',
      art: {backdrop: m.background || '', poster: m.poster || '', logo: m.logo || ''}};
    return {id: id};
  }

  // Episode counts for a show that came from a list: TMDB when it has the id, otherwise Cinemeta's videos.
  function loadSeasons(id, done) {
    var t = TITLES[id];
    if (t.seasons) { done(); return; }
    t.seasons = [10];
    if (t.tmdb && CFG.tmdbKey) { delete art[id]; loadArt(id, function () { done(); }); return; }
    get(CINEMETA + '/meta/series/' + id + '.json', function (o) {
      var v = o && o.meta && o.meta.videos || [], n = [];
      for (var i = 0; i < v.length; i++) if (v[i].season > 0) n[v[i].season - 1] = Math.max(n[v[i].season - 1] || 0, v[i].episode);
      if (n.length) t.seasons = n.map(function (x) { return x || 1; });
      done();
    });
  }

  function loadRow(r) {
    var row = HOME.rows[r], src = row.source;
    if (!src) return;
    function done(items) {
      if (!items || items.length < 4) return;              // keep the stand-ins when a list comes back thin
      row.items = items.slice(0, row.limit || 20);
      row.live = true;
      fillRow(r);
      if (state.screen === 'home' && !S.open && !sheet.open) paintHome();
    }
    if (src.tmdb && CFG.tmdbKey) {
      var type = /^tv\//.test(src.tmdb) ? 'tv' : 'movie';
      get('https://api.themoviedb.org/3/' + src.tmdb + (src.tmdb.indexOf('?') < 0 ? '?' : '&') + 'api_key=' +
          encodeURIComponent(CFG.tmdbKey) + '&language=pt-BR', function (o) {
        done(o && o.results && o.results.filter(function (x) { return x.backdrop_path && x.media_type !== 'person'; })
          .map(function (x) { return fromTmdb(x, type); }));
      });
    } else if (src.cinemeta || src.addon) {
      var url = src.addon || CINEMETA + '/catalog/' + src.cinemeta + '.json', kind = src.type || src.cinemeta.split('/')[0];
      get(url, function (o) {
        done(o && o.metas && o.metas.filter(function (m) { return m.poster; }).map(function (m) { return fromCinemeta(m, m.type || kind); }));
      });
    }
  }

  // The catalogs of the addons in Erick's account, after the built-in rows (Cinemeta's are there already).
  var ADDONS = [];
  function loadAddons() {
    var key = (CFG.stremioAuthKey || '').trim();
    if (!key) return;
    var x = new XMLHttpRequest();
    x.open('POST', 'https://api.strem.io/api/addonCollectionGet', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status !== 200) return;
      var o; try { o = JSON.parse(x.responseText); } catch (e) { return; }
      var list = o && o.result && o.result.addons || [];
      ADDONS = list.map(function (a) { return a.manifest && a.manifest.name; }).filter(Boolean);
      for (var i = 0; i < list.length; i++) {
        var m = list[i].manifest || {}, base = (list[i].transportUrl || '').replace(/\/manifest\.json$/, '');
        if (!base || m.id === 'com.linvo.cinemeta') continue;
        var cats = m.catalogs || [];
        for (var j = 0; j < cats.length; j++) {
          var c = cats[j], needs = (c.extra || []).some(function (e) { return e.isRequired; }) || (c.extraRequired || []).length;
          if (needs || (c.type !== 'movie' && c.type !== 'series')) continue;
          HOME.rows.push({kind: c.type === 'series' ? 'wide' : 'poster', title: catalogName(c.name || c.id, m.name), subtitle: m.name,
            source: {addon: base + '/catalog/' + c.type + '/' + encodeURIComponent(c.id) + '.json', type: c.type}, items: []});
          addRow(HOME.rows.length - 1);
          loadRow(HOME.rows.length - 1);
        }
      }
    };
    x.send(JSON.stringify({type: 'AddonCollectionGet', authKey: key, update: true}));
  }

  // MARK: - Stremio's library: Continue watching comes from it, and playback saves the position back to it, so
  // Stremio (and its Trakt sync) see the same progress.

  var LIB = {};
  function stremio(method, body, done) {
    var x = new XMLHttpRequest();
    x.open('POST', 'https://api.strem.io/api/' + method, true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var o = null;
      try { o = x.status === 200 ? JSON.parse(x.responseText) : null; } catch (e) {}
      if (done) done(o && o.result);
    };
    x.ontimeout = x.onerror = function () { if (done) done(null); };
    body.authKey = (CFG.stremioAuthKey || '').trim();
    x.send(JSON.stringify(body));
  }

  function loadLibrary() {
    if (!(CFG.stremioAuthKey || '').trim()) return;
    stremio('datastoreGet', {collection: 'libraryItem', all: true}, function (items) {
      if (!items || !items.length) return;
      var list = items.filter(function (it) {
        return (!it.removed || it.temp) && it.state && it.state.timeOffset > 0 && (it.type === 'movie' || it.type === 'series') && /^tt\d+$/.test(it._id);
      }).sort(function (a, b) { return Date.parse(b.state.lastWatched || b._mtime) - Date.parse(a.state.lastWatched || a._mtime); }).slice(0, 12);
      if (!list.length) return;
      var left = list.length, out = [];
      list.forEach(function (it, i) {
        LIB[it._id] = it;
        var st = it.state, ep = /:(\d+):(\d+)$/.exec(st.video_id || '');
        out[i] = {id: it._id, s: ep ? +ep[1] : 0, e: ep ? +ep[2] : 0, posMs: st.timeOffset,
          progress: st.duration ? Math.min(1, st.timeOffset / st.duration) : 0,
          left: st.duration ? Math.max(1, Math.round((st.duration - st.timeOffset) / 60000)) : 0};
        libraryTitle(it, function () { if (--left === 0) showLibrary(out); });
      });
    });
  }
  // A library item knows only its name and poster: the rest from Cinemeta, and the TMDB id for the pt-BR art.
  function libraryTitle(it, done) {
    var id = it._id;
    if (TITLES[id] && TITLES[id].desc) { done(); return; }
    get(CINEMETA + '/meta/' + it.type + '/' + id + '.json', function (o) {
      var m = o && o.meta || {name: it.name, poster: it.poster};
      delete TITLES[id];
      fromCinemeta(m, it.type);
      if (!CFG.tmdbKey) { done(); return; }
      get('https://api.themoviedb.org/3/find/' + id + '?external_source=imdb_id&api_key=' + encodeURIComponent(CFG.tmdbKey), function (f) {
        var hit = f && ((f.movie_results || [])[0] || (f.tv_results || [])[0]);
        if (hit) TITLES[id].tmdb = hit.id;
        done();
      });
    });
  }
  function showLibrary(items) {
    var row = HOME.rows[0];
    row.items = items; row.live = true;
    fillRow(0);
    if (state.screen === 'home' && !S.open && !sheet.open) { renderHero(); paintHome(); }
  }

  // The position goes back to the library every 30 s, on pause and on leaving, like Stremio's own player does.
  function saveProgress() {
    if (!REAL || !P.started || !(CFG.stremioAuthKey || '').trim()) return;
    var t = P.t, imdb = /^tt\d+$/.test(P.id) ? P.id : t.imdb;
    if (!imdb || !(P.dur > 0)) return;
    var at = new Date().toISOString(), old = LIB[imdb];
    var it = old ? JSON.parse(JSON.stringify(old)) : {_id: imdb, name: t.title, type: t.type, poster: t.art && t.art.poster || '',
      posterShape: 'poster', removed: true, temp: true, _ctime: at,
      state: {lastWatched: at, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0,
        duration: 0, video_id: imdb, watched: '', noNotif: false},
      behaviorHints: {defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false}};
    var st = it.state, watched = Math.max(0, now() - (P.savedAt || P.rec.at));
    P.savedAt = now();
    st.lastWatched = at;
    st.timeWatched = (st.timeWatched || 0) + watched;
    st.overallTimeWatched = (st.overallTimeWatched || 0) + watched;
    st.duration = Math.round(P.dur * 1000);
    st.timeOffset = Math.round(P.pos * 1000);
    st.video_id = P.s ? imdb + ':' + P.s + ':' + P.e : imdb;
    if (!P.s && P.pos / P.dur > 0.9) { st.timeOffset = 0; st.flaggedWatched = 1; st.timesWatched = (st.timesWatched || 0) + 1; }
    it._mtime = at;
    LIB[imdb] = it;
    stremio('datastorePut', {collection: 'libraryItem', changes: [it]}, function (ok) {
      if (!ok) console.log('[library] não salvou a posição de ' + imdb);
    });
  }

  // The addons name their catalogs in English: the common ones in Portuguese, the rest as they are.
  function catalogName(n, addon) {
    var trakt = /trakt/i.test(addon), lb = /boxd/i.test(addon);
    var m = /^(.*)'s Watchlist$/.exec(n);
    if (m) return lb ? 'Sua watchlist do Letterboxd' : 'Sua watchlist';
    var map = {'Recommended Movies': 'Filmes recomendados', 'Recommended TV': 'Séries recomendadas', 'Movie Watchlist': 'Filmes na watchlist',
      'TV Watchlist': 'Séries na watchlist', 'Continue Watching Movies': 'Filmes pela metade', 'Continue Watching TV': 'Séries pela metade',
      'Start Watching': 'Pra começar', 'Popular This Week': 'Populares da semana', 'Top 250': 'Top 250'};
    var out = map[n] || n.replace(/ Movies$/, ': filmes').replace(/ (TV|Shows|Series)$/, ': séries');
    return out + (trakt ? ' · Trakt' : lb ? ' · Letterboxd' : '');
  }

  // The picks have three views: all, new releases (last three years) and classics (before 2000).
  var PICKS = ['Tudo', 'Lançamentos', 'Clássicos'];
  function visible(r) {
    var row = HOME.rows[r];
    if (row.kind !== 'picks' || !H.pick) return row.items;
    var y = new Date().getFullYear();
    return row.items.filter(function (it) {
      var t = TITLES[it.id];
      return H.pick === 1 ? t.year >= y - 3 : t.year < 2000;
    });
  }

  function addRow(r) {
    var row = HOME.rows[r], cls = CARD[row.kind];
    var e = el('div', 'row ' + row.kind + (cls === 'poster' || cls === 'chart' ? ' tall' : ''));
    e.appendChild(el('h2', '', esc(row.title)));
    if (row.kind === 'picks') {
      var chips = el('div', 'chips');
      for (var i = 0; i < PICKS.length; i++) chips.appendChild(el('span', '', PICKS[i]));
      e.appendChild(chips);
    }
    e.appendChild(el('div', 'sub', esc(row.subtitle || '')));
    var track = el('div', 'track');
    e.appendChild(track);
    $('#rows').appendChild(e);
    H.rows[r] = {el: e, track: track, cards: [], step: STEP[cls], chips: chips};
    H.idx[r] = 0;
    fillRow(r);
  }

  function fillRow(r) {
    var row = HOME.rows[r], R2 = H.rows[r], items = visible(r);
    R2.track.innerHTML = '';
    R2.cards = [];
    for (var i = 0; i < items.length; i++) { var c = card(row.kind, items[i], i); R2.track.appendChild(c); R2.cards.push(c); }
    if (H.idx[r] >= items.length) H.idx[r] = Math.max(0, items.length - 1);
    if (R2.chips) for (i = 0; i < PICKS.length; i++) R2.chips.children[i].className = i === H.pick ? 'on' : '';
    R2.el.style.display = items.length ? '' : 'none';
  }

  function buildRows() {
    $('#rows').innerHTML = '';
    H.rows = []; H.idx = []; H.pick = 0; H.chips = false;
    for (var r = 0; r < HOME.rows.length; r++) addRow(r);
    for (r = 0; r < HOME.rows.length; r++) loadRow(r);
    loadAddons();
    loadLibrary();
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
      if (row.chips) for (var i = 0; i < PICKS.length; i++) row.chips.children[i].className = i === H.pick ? (H.chips ? 'focus' : 'on') : '';
      setFocus(H.chips ? null : row.cards[H.idx[H.row]]);
    }
  }

  function homeItem() {
    if (H.zone === 'hero') return heroItem();
    return visible(H.row)[H.idx[H.row]] || visible(H.row)[0];
  }

  // The next row with something in it (a dynamic list that came back empty stays hidden).
  function nextRow(r, d) {
    for (var i = r + d; i >= 0 && i < H.rows.length; i += d) if (H.rows[i].cards.length) return i;
    return -1;
  }

  function homeKey(k) {
    if (H.chips) return chipsKey(k);
    if (k === 'up') {
      if (H.zone === 'rows') {
        if (H.rows[H.row].chips) H.chips = true;
        else { var u = nextRow(H.row, -1); if (u >= 0) H.row = u; else H.zone = 'hero'; }
      }
    } else if (k === 'down') {
      if (H.zone === 'hero') { H.zone = 'rows'; H.row = nextRow(-1, 1); }
      else { var d = nextRow(H.row, 1); if (d >= 0) { H.row = d; if (H.rows[d].chips) H.chips = true; } }
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
      if (H.zone === 'rows') { H.zone = 'hero'; homeShown(); }       // Back from a row scrolls to the top first, like tvOS
      else { openSide(); return; }
    } else if (k === 'menu') {
      openSources(homeItem().id, null, function (s) { play(homeItem().id, continueOf(homeItem().id) || {}, s); });
      return;
    }
    heroTick();
    paintHome();
    focusTitle(homeItem().id);
  }

  // The three views of the picks, above their row: ← → choose, ↓ goes into the row, ↑ leaves it.
  function chipsKey(k) {
    if (k === 'left' && H.pick > 0) { H.pick--; fillRow(H.row); }
    else if (k === 'right' && H.pick < PICKS.length - 1) { H.pick++; fillRow(H.row); }
    else if (k === 'down' || k === 'ok') H.chips = false;
    else if (k === 'up') { H.chips = false; var u = nextRow(H.row, -1); if (u >= 0) H.row = u; else H.zone = 'hero'; }
    else if (k === 'back') { H.chips = false; H.zone = 'hero'; homeShown(); }
    else return;
    paintHome();
    if (!H.chips) focusTitle(homeItem().id);
  }

  // MARK: - Sidebar

  var S = {open: false, i: 1, items: [
    {ico: '⌕', a: 'Buscar'}, {ico: '⌂', a: 'Início', on: true}, {ico: '▭', a: 'Filmes'}, {ico: '▤', a: 'Séries'},
    {ico: '✦', a: 'Curadoria'}, {ico: '♡', a: 'Biblioteca'}, {sep: true},
    {ico: '⚙', a: 'Ajustes', act: function () { openSettings(); }}
  ]};
  function openSide() { S.open = true; S.i = 1; homeShown(); renderSide(); }
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
      if (it.act) it.act();
      else if (it.a === 'Início') closeSide();
      else toast('No protótipo, só o Início está montado');
    }
  }

  // MARK: - Settings: Stremio's player settings (stremio-core's profile settings) and the account's addons

  var SET = {binge: 0, notice: 0, intro: 0, seek: 0, maxRes: 0, hdr: 0, audioLang: 0, subLang: 0, subLang2: 0, subSize: 0, subBg: 0, rate: 0};
  try { var saved = JSON.parse(localStorage.getItem('sofa.proto.settings') || '{}'); for (var sk in saved) SET[sk] = saved[sk]; } catch (e) {}
  var OPTS = {
    binge: ['ligado', 'desligado'], notice: ['20 s antes do fim', '35 s antes do fim', '10 s antes do fim'],
    intro: ['mostrar o botão Pular', 'pular sozinho', 'não pular'], seek: ['10 s', '15 s', '30 s'],
    maxRes: ['automática (TV 1080p)', 'até 1080p', 'até 720p'], hdr: ['HDR10 quando houver', 'preferir SDR'],
    // Off like tvOS's Match Frame Rate: switching the TV to 24 Hz blanks the screen for a second or two at every start.
    rate: ['desligado', 'ligado (24p sem tremor, começa mais devagar)'],
    audioLang: ['original', 'português'], subLang: ['português (Brasil)', 'português', 'inglês', 'desligadas'],
    subLang2: ['inglês', 'português', 'nenhum'], subSize: ['médio', 'grande', 'pequeno'], subBg: ['contorno', 'caixa escura']
  };
  function opt(k) { return OPTS[k][SET[k] % OPTS[k].length]; }
  function settingItems() {
    function o(k, a) { return {a: a, val: opt(k), act: function () { SET[k] = (SET[k] + 1) % OPTS[k].length; try { localStorage.setItem('sofa.proto.settings', JSON.stringify(SET)); } catch (e) {} R = {}; openSettings(true); }}; }
    function ro(a, v) { return {a: a, val: v, act: function () { toast(a + ': ' + v); }}; }
    var items = [
      {head: 'Conta'},
      ro('Stremio', CFG.stremioAuthKey ? 'conectado' : 'sem login neste build'),
      ro('Debrid', 'TorBox · só fontes em cache'),
      ro('Continuar assistindo', CFG.stremioAuthKey ? 'biblioteca do Stremio (posição salva lá)' : 'exemplo'),
      {head: 'Reprodução'},
      o('binge', 'Assistir em sequência'), o('notice', 'Aviso do próximo episódio'), o('intro', 'Abertura'),
      o('seek', 'Pulo com ← →'), o('maxRes', 'Qualidade máxima'), o('hdr', 'HDR'), o('rate', 'Ajustar à taxa de quadros'),
      {head: 'Áudio'},
      o('audioLang', 'Idioma preferido'), ro('Saída', 'estéreo PCM (a TV não aceita surround)'),
      {head: 'Legendas'},
      o('subLang', 'Idioma'), o('subLang2', 'Segundo idioma'), o('subSize', 'Tamanho'), o('subBg', 'Fundo'),
      {head: 'Addons'}
    ];
    var names = ADDONS.length ? ADDONS : ['MyTrakt Sync', 'Stremboxd', 'Cinemeta', 'OpenSubtitles v3', 'AIOStreams'];
    for (var i = 0; i < names.length; i++) items.push(ro(names[i], 'instalado'));
    items.push({head: 'Protótipo'});
    items.push({a: 'Métricas na tela', val: hudOn ? 'ligadas' : 'desligadas', act: function () { hudOn = !hudOn; try { localStorage.setItem('sofa.proto.hud', hudOn ? '1' : '0'); } catch (e) {} hud(); openSettings(true); }});
    items.push({a: 'Zerar o log de uso', val: M.log.length + ' registros', act: function () { M.log = []; M.last = null; saveLog(); hud(); openSettings(true); }});
    return items;
  }
  function openSettings(keep) {
    var i = sheet.i;
    S.open = false; $('#side').className = 'hidden';
    openSheet('Ajustes', settingItems(), null, 'settings');
    if (keep) { sheet.i = i; renderSheet(); }
  }
  // What the ranking gets: the TV's measurements, narrowed by the settings.
  function caps() {
    var c = {}; for (var k in CAPS) c[k] = CAPS[k];
    if (SET.maxRes === 1) c.limit = 1080;
    if (SET.maxRes === 2) { c.limit = 720; c.maxHeight = 720; }
    c.preferSdr = SET.hdr === 1;
    c.ptAudio = SET.audioLang === 1;
    return c;
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
    $('#detail .credits').textContent = t.director ? 'Direção: ' + t.director + ' · Fotografia: ' + t.dop : t.rating ? 'Nota ' + t.rating : '';
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
    if (t.type === 'series' && !t.seasons) loadSeasons(id, function () { if (D.id === id) { buildDetailRows(); paintDetail(); } });
    else if (t.type === 'series') loadSeasons(id, function () {});
    buildDetailRows();
    resolve(id);
    renderPick();
    paintDetail();
    focusTitle(id);
  }

  // What will play on this TV, chosen in advance: the badges and the line under the buttons.
  function renderPick() {
    var r = picked(D.id), badges = $('#detail .badges'), pick = $('#detail .pick');
    if (!r || !r.ready) { badges.innerHTML = ''; pick.textContent = 'Escolhendo a melhor fonte pra esta TV…'; return; }
    var s = r.rank.play[0];
    if (!s) {
      badges.innerHTML = '';
      pick.textContent = r.error ? 'Sem fonte: ' + r.error :
        r.rank.out.length + (r.rank.out.length === 1 ? ' fonte, nenhuma toca aqui: ' : ' fontes, nenhuma toca aqui: ') + r.rank.out[0].why;
      return;
    }
    preload(D.id, continueOf(D.id) || D.item || {});
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
    for (var id in TITLES) if (id !== D.id && TITLES[id].genres.indexOf(g) >= 0 && rel.length < 12) rel.push({id: id});
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
  function openSheet(title, items, onClose, variant) {
    sheet.open = true; sheet.items = items; sheet.close = onClose || null;
    $('#sheet .box').className = 'box' + (variant ? ' ' + variant : '');
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
    hud();
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
        '<span class="chk">' + (it.chk ? '✓' : '') + '</span>' + (it.val != null ? '<span class="v">' + esc(it.val) + '</span>' : '') + '<div class="a">' + esc(it.a) + (it.tag ? '<span class="tag">' + esc(it.tag) + '</span>' : '') + '</div>' +
        (it.b ? '<div class="b">' + esc(it.b) + '</div>' : ''));
      list.appendChild(e);
      if (i === sheet.i) focusEl = e;
    }
    setFocus(focusEl);
    // Keep the focused option in view.
    var y = focusEl ? focusEl.offsetTop : 0;
    translate(list, 0, -Math.max(0, y - Math.max(300, $('#sheet .box').clientHeight - 300)));
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

  function sourceItems(r, current, pick) {
    var items = [{head: 'Tocáveis nesta TV · melhor primeiro'}];
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

  function openSources(id, current, pick, s, e) {
    M.log.push({kind: 'menu', at: now(), id: id}); saveLog();
    resolve(id, function (r) { openSheet('Fontes', sourceItems(r, current, pick)); }, s, e);
  }

  // MARK: - Player (simulated video, real flow around it)

  var P = {id: '', t: null, s: 0, e: 0, pos: 0, dur: 0, paused: false, stream: null, list: [], zone: 'bar', pill: 0,
           osdTimer: 0, tick: 0, started: false, failedOnce: false, subs: 1, audio: 0, nextCount: 0, rec: null, tabs: false, tab: 0};

  function play(id, from, chosen) {
    var t = TITLES[id], t0 = now(), clicks = M.clicks, warm = R[id] && R[id].ready;
    P.id = id; P.t = t; P.s = from && from.s || (t.type === 'series' ? 1 : 0); P.e = from && from.e || (t.type === 'series' ? 1 : 0);
    P.dur = (t.type === 'series' ? 50 : t.runtime) * 60;
    P.pos = from && from.posMs ? from.posMs / 1000 : from && from.progress ? from.progress * P.dur : 0;   // resume without asking (HIG: playing video)
    P.savedAt = 0;
    if (t.type === 'series' && !P.pos && !REAL) P.pos = 30;        // so skip intro shows up soon in the demo
    loadSegments(id, P.s, P.e);
    P.paused = false; P.started = false; P.zone = 'bar'; P.pill = 0; P.tabs = false; P.nextCount = 0;
    show('player');
    $('#player .frame').className = 'frame';
    $('#player .skip').className = 'skip';
    $('#player .next').className = 'next';
    $('#player .tabs').className = 'tabs';
    osd(false);
    setFocus(null);
    P.spin = setTimeout(function () { $('#player .spinner').className = 'spinner on'; }, 2000);   // only after 2 s (HIG)
    resolve(id, function (r) {
      P.list = r.rank.play.slice();
      P.stream = chosen || P.list[0];
      P.rec = {kind: 'play', at: t0, id: id, clicks: clicks, warm: !!warm, manual: !!chosen, kept: !chosen, fallbacks: 0, ttff: 0, real: REAL};
      if (REAL) {
        if (!P.stream) { toast('Nenhuma fonte em cache que esta TV toque'); stopPlayer(); return; }
        openNative(P.pos);
        return;
      }
      var spin = P.spin;
      // The time to open the link and fill the buffer: Media3 on the stick with a TorBox link, from the AIOStreams
      // answer on. Bigger files take a little longer to start.
      var open = rnd(700, 1100) + P.stream.mbps * 18;
      setTimeout(function () {
        if (state.screen !== 'player' || P.id !== id) return;
        clearTimeout(spin);
        $('#player .spinner').className = 'spinner';
        firstFrame();
      }, open);
    }, P.s, P.e);
    episodeLabel();
  }

  // MARK: - The native player (Fire TV): Media3 under the page, the page draws everything on top

  function openNative(fromSec) {
    var st = P.stream;
    if (st.subsWait) { withSubs(st, function () { if (state.screen === 'player' && P.stream === st) openNative(fromSec); }); return; }
    preloadKey = ''; P.subPicked = false;
    document.body.className = 'native';
    $('#player .subs').textContent = '';
    $('#player .subs').className = 'subs size' + SET.subSize + ' bg' + SET.subBg;
    P.tracks = null; P.started = false;
    var s = P.stream;
    window.Player.open(JSON.stringify({url: s.url, startMs: Math.round(fromSec * 1000), subtitles: s.subs || [], matchRate: SET.rate === 1}));
  }

  // External subtitles for a stream, fetched while pre-resolving so they're there at OK. OpenSubtitles ranks them
  // by the file's hash and name (same release, in sync); we keep the first pt-BR, pt and en.
  function loadSubs(st, id, s, e) {
    if (st.subs) return;
    st.subs = []; st.subsWait = [];
    var type = s ? 'series' : 'movie', extra = [];
    if (st.videoHash) extra.push('videoHash=' + st.videoHash);
    if (st.videoSize) extra.push('videoSize=' + st.videoSize);
    if (st.filename) extra.push('filename=' + encodeURIComponent(st.filename));
    get('https://opensubtitles-v3.strem.io/subtitles/' + type + '/' + videoId(id, s, e) + (extra.length ? '/' + extra.join('&') : '') + '.json', function (o) {
      var all = o && o.subtitles || [], out = [], want = [['pob', 'pt-BR', 'Português (Brasil)'], ['por', 'pt', 'Português'], ['eng', 'en', 'English']];
      for (var w = 0; w < want.length; w++) {
        for (var i = 0; i < all.length; i++) if (all[i].lang === want[w][0]) { out.push({url: all[i].url, lang: want[w][1], label: want[w][2] + ' · OpenSubtitles'}); break; }
      }
      st.subs = out;
      var w = st.subsWait; st.subsWait = null;
      for (var j = 0; j < w.length; j++) w[j]();
    });
  }
  // Opening waits up to 1.5 s for the subtitles, so pt-BR is there from the first line.
  function withSubs(st, done) {
    if (!st.subsWait) { done(); return; }
    var once = false, go = function () { if (!once) { once = true; done(); } };
    st.subsWait.push(go);
    setTimeout(go, 1500);
  }

  // The title's page prepares its stream paused behind the page, so OK only presses play (TTFF under a second).
  var preloadKey = '';
  function preload(id, from) {
    if (!REAL || !window.Player.preload || state.screen === 'player') return;
    var t = TITLES[id], s = from.s || 0, e = from.e || 0;
    if (t.type === 'series' && !s) { var d = defaultEp(id); s = d.s; e = d.e; }
    var r = R[videoId(id, s, e)], st = r && r.ready && r.rank.play[0];
    if (!st) return;
    var startMs = from.posMs || (from.progress ? from.progress * (t.runtime || 50) * 60000 : 0);
    var key = st.url + '@' + Math.round(startMs / 5000);
    if (key === preloadKey) return;
    preloadKey = key;
    withSubs(st, function () {
      if (preloadKey !== key || state.screen === 'player') return;
      console.log('[player] preload ' + videoId(id, s, e) + ' · ' + Ranking.label(st));
      window.Player.preload(JSON.stringify({url: st.url, startMs: Math.round(startMs), subtitles: st.subs || [], matchRate: SET.rate === 1}));
    });
  }
  function unpreload() {
    if (!preloadKey) return;
    preloadKey = '';
    if (REAL) window.Player.stop();
  }

  // What the native player says (Playback.java → Native.player).
  window.Native = {player: function (ev) {
    if (state.screen !== 'player' || !REAL) return;
    if (ev.type === 'firstFrame') {
      clearTimeout(P.spin);
      if (!P.rec.ttff) console.log('[player] TTFF ' + (now() - P.rec.at) + ' ms do OK (player ' + ev.ms + ' ms) · ' +
        (P.rec.warm ? 'pré-resolvido' : 'resolvido no OK') + ' · ' + Ranking.label(P.stream));
      $('#player .spinner').className = 'spinner';
      if (!P.rec.ttff) firstFrame();
      else P.started = true;
    } else if (ev.type === 'ready') {
      if (ev.dur > 0) P.dur = ev.dur / 1000;
      $('#player .spinner').className = 'spinner';
    } else if (ev.type === 'buffering') {
      if (P.started) $('#player .spinner').className = 'spinner on';
    } else if (ev.type === 'error' || ev.type === 'stall') {
      fallback(ev.type === 'error' ? 'A fonte falhou' : 'A fonte travou');
    } else if (ev.type === 'ended') {
      P.pos = P.dur; saveProgress();
      if (P.s && hasNext()) nextEpisode(); else stopPlayer();
    } else if (ev.type === 'tracks') {
      P.tracks = ev;
      if (!P.subPicked) pickSubtitle(ev.text || []);
    } else if (ev.type === 'cues') {
      $('#player .subs').innerHTML = ev.text ? '<span>' + esc(ev.text).replace(/\n/g, '<br>') + '</span>' : '';
    } else if (ev.type === 'warm') {
      M.warm = ev.ms;
    }
    hud();
  }};

  // Subtitles: pt-BR first (the file's own track when it says Brazil, it's in sync), then OpenSubtitles' pt-BR,
  // then any Portuguese that isn't marked European, then English. Media3 alone treats pt-PT as pt.
  function subScore(x) {
    var lang = (x.lang || '').toLowerCase(), label = x.label || '', ext = /^ext/.test(x.id || '') || /OpenSubtitles/.test(label);
    var br = /^(pt-br|pob)$/.test(lang) || /Bras|Brazil|\bBR\b/i.test(label);
    var eu = /^pt-pt$/.test(lang) || /Portugal|European|\bPT-PT\b|Europeu/i.test(label);
    var pt = /^(pt|por)(-|$)/.test(lang);
    // A forced track only carries signs and lines in a third language: not for a film in another language.
    if (/forced|for[cç]ad/i.test(label) || x.forced) return 5;
    if (br) return ext ? 90 : 100;
    if (pt && !eu) return ext ? 60 : 70;
    if (/^(en|eng)(-|$)/.test(lang)) return SET.subLang === 2 ? 110 : 30;
    if (pt) return 20;
    return 0;
  }
  function pickSubtitle(list) {
    P.subPicked = true;
    if (SET.subLang === 3) { window.Player.select(2, -1, 0); return; }   // off in Settings
    var best = null, bs = 0, sel = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].supported === false) continue;
      var sc = subScore(list[i]);
      if (sc > bs) { bs = sc; best = list[i]; }
      if (list[i].selected) sel = list[i];
    }
    if (!best) return;
    console.log('[player] legenda: ' + (best.label || best.lang) + (sel && sel !== best ? ' (o player tinha escolhido ' + (sel.label || sel.lang) + ')' : ''));
    if (best !== sel) window.Player.select(2, best.group, best.index);
  }

  // The stream broke: the next one takes over at the same position, without the person doing anything.
  function fallback(why) {
    var i = P.list.indexOf(P.stream), next = P.list[i + 1];
    if (!next) { toast(why + ' e não há outra fonte'); stopPlayer(); return; }
    P.stream = next; loadSubs(next, P.id, P.s, P.e);
    if (P.rec) { P.rec.kept = false; P.rec.fallbacks++; saveLog(); }
    toast(why + '. Troquei pra ' + Ranking.label(next));
    openNative(P.pos);
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
    if (REAL) {
      var st = {};
      try { st = JSON.parse(window.Player.state()); } catch (e) {}
      if (st.pos != null) P.pos = st.pos / 1000;
      if (st.dur > 0) P.dur = st.dur / 1000;
      if (now() - (P.savedAt || P.rec.at) > 30000) saveProgress();
    } else if (!P.paused) P.pos += 0.25;
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
    var skip = $('#player .skip'), seg = segmentAt(P.pos);
    if (seg && SET.intro === 1 && !seg.done) { seg.done = true; seekBy(seg.to - P.pos); toast(seg.label.replace('Pular', 'Pulei')); seg = null; }
    if (seg && (skip.className.indexOf('on') < 0 || P.seg !== seg)) { skip.className = 'skip on'; skip.innerHTML = '<span class="btn lift">' + seg.label + '</span>'; }
    if (!seg && skip.className.indexOf('on') >= 0) skip.className = 'skip';
    P.seg = seg;
    var left = P.dur - P.pos, next = $('#player .next');
    var notice = [20, 35, 10][SET.notice] || 20;
    // With the credits' start known, Up Next shows when they start and plays 15 s later (like the TV app).
    var credits = P.segs && P.segs.credits, atCredits = credits && P.pos >= credits && left > 5;
    if (atCredits) left = Math.min(left, credits + 15 + 5 - P.pos);
    if (P.s && (left <= notice || atCredits) && hasNext()) {
      if (next.className.indexOf('on') < 0) showNext();
      $('.count', next).textContent = SET.binge === 0 ? 'Começa em ' + Math.max(0, Math.ceil(left - 5)) + ' s · mesma fonte' : 'OK pra assistir';
      if (left <= 5 && SET.binge === 0) nextEpisode();
    } else if (!REAL && !P.s && left <= 0) { stopPlayer(); return; }
    renderOsd();
  }

  // Intros, recaps and credits from TheIntroDB (free, by TMDB id); the simulation has a made-up intro.
  var SEGS = {};
  function loadSegments(id, s, e) {
    P.segs = null;
    if (!s) return;
    if (!REAL) { P.segs = {skip: [{from: 40, to: 100, label: 'Pular abertura'}], credits: 0}; return; }
    var key = id + ':' + s + ':' + e;
    if (SEGS[key]) { P.segs = SEGS[key]; return; }
    tmdbOf(id, function (tmdb) {
      if (!tmdb) return;
      get('https://api.theintrodb.org/v4/media?tmdb_id=' + tmdb + '&season=' + s + '&episode=' + e, function (o) {
        if (!o) return;
        var out = {skip: [], credits: 0};
        function add(list, label) {
          for (var i = 0; list && i < list.length; i++) {
            var a = list[i].start_ms || 0, b = list[i].end_ms;   // no start: from the beginning
            if (b && b > a) out.skip.push({from: a / 1000, to: b / 1000, label: label});
          }
        }
        add(o.recap, 'Pular recapitulação'); add(o.intro, 'Pular abertura');
        if (o.credits && o.credits[0] && o.credits[0].start_ms) out.credits = o.credits[0].start_ms / 1000;
        SEGS[key] = out;
        console.log('[player] TheIntroDB ' + key + ': ' + out.skip.map(function (x) { return x.label + ' ' + Math.round(x.from) + '–' + Math.round(x.to) + ' s'; }).join(', ') +
          (out.credits ? ' · créditos em ' + Math.round(out.credits) + ' s' : ''));
        if (P.id === id && P.s === s && P.e === e) P.segs = out;
      });
    });
  }
  function segmentAt(pos) {
    if (!P.segs || SET.intro === 2) return null;
    for (var i = 0; i < P.segs.skip.length; i++) {
      var x = P.segs.skip[i];
      if (pos >= x.from && pos < x.to - 2) return x;
    }
    return null;
  }
  function tmdbOf(id, done) {
    var t = TITLES[id];
    if (t.tmdb) { done(t.tmdb); return; }
    if (!CFG.tmdbKey || !/^tt\d+$/.test(id)) { done(0); return; }
    get('https://api.themoviedb.org/3/find/' + id + '?external_source=imdb_id&api_key=' + encodeURIComponent(CFG.tmdbKey), function (f) {
      var hit = f && ((f.tv_results || [])[0] || (f.movie_results || [])[0]);
      if (hit) t.tmdb = hit.id;
      done(t.tmdb || 0);
    });
  }

  function hasNext() { return P.e < P.t.seasons[P.s - 1] || P.s < P.t.seasons.length; }
  function showNext() {
    var n = $('#player .next'), s = P.s, e = P.e + 1;
    if (e > P.t.seasons[s - 1]) { s++; e = 1; }
    if (REAL) {
      var group = P.stream && P.stream.bingeGroup;
      resolve(P.id, function (r) { var st = sameRelease(r.rank.play, group); if (st) { window.Player.warm(st.url); loadSubs(st, P.id, s, e); } }, s, e);
    }
    n.className = 'next on';
    $('.ep', n).textContent = 'T' + s + ' E' + e;
    episodeName(P.id, s, e, function (name) { $('.ep', n).textContent = 'T' + s + ' E' + e + ' · ' + name; });
    $('.thumb', n).style.backgroundImage = gradient(P.t);
    loadSeason(P.id, s, function (eps) { if (eps && eps[e - 1] && eps[e - 1].still) $('.thumb', n).style.backgroundImage = 'url("' + eps[e - 1].still + '")'; });
    if (!$('#player .osd').className.match(/\bon\b/)) setFocus(n);
  }
  // The next episode keeps the stream's bingeGroup (same release group and quality), so it starts as fast.
  // The same release for the next episode (its bingeGroup), or the best one.
  function sameRelease(list, group) {
    for (var i = 0; i < list.length && group; i++) if (list[i].bingeGroup === group) return list[i];
    return null;
  }
  function nextEpisode() {
    var s = P.s, e = P.e + 1;
    if (e > P.t.seasons[s - 1]) { s++; e = 1; }
    if (REAL) { P.pos = P.dur; saveProgress(); }
    P.s = s; P.e = e; P.pos = 0; P.failedOnce = false;
    loadSegments(P.id, s, e);
    $('#player .next').className = 'next';
    setFocus(null);
    episodeLabel();
    if (REAL) {
      var group = P.stream.bingeGroup;
      P.started = false;
      P.rec = {kind: 'next', at: now(), id: P.id, clicks: 0, warm: !!R[videoId(P.id, s, e)], manual: false, kept: true, fallbacks: 0, ttff: 0, real: true};
      resolve(P.id, function (r) {
        P.list = r.rank.play.slice();
        var same = sameRelease(P.list, group);
        P.stream = same || P.list[0];
        if (!P.stream) { toast('Sem fonte pro próximo episódio'); stopPlayer(); return; }
        toast('T' + s + ' E' + e + (same ? ' · mesma fonte' : ''));
        openNative(0);
      }, s, e);
      return;
    }
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

  function realTrackItems(kind) {
    var list = kind === 2 ? [{a: 'Desligadas', act: function () { window.Player.select(2, -1, -1); $('#player .subs').textContent = ''; closeSheet(); }}] : [];
    var tracks = P.tracks && (kind === 1 ? P.tracks.audio : P.tracks.text) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i], ext = /^ext/.test(String(t.id || '')) || /OpenSubtitles/.test(t.label || '');
      list.push({a: t.label || langName(t.lang) || 'Faixa ' + (i + 1), chk: t.selected,
        b: kind === 1 ? (t.mime || '').replace('audio/', '').toUpperCase() + (t.channels ? ' · ' + t.channels + ' canais' : '') + (t.supported ? '' : ' · não toca')
                      : (ext ? 'Externa' : 'Do próprio arquivo · em sincronia') + (t.lang ? ' · ' + t.lang : ''),
        act: (function (t) { return function () { window.Player.select(kind, t.group, t.index); closeSheet(); }; })(t)});
    }
    if (list.length < (kind === 2 ? 2 : 1)) list.push({a: 'Ainda carregando as faixas…', off: true});
    return list;
  }
  function langName(l) {
    return {'pt-BR': 'Português (Brasil)', 'pt': 'Português', 'por': 'Português', 'pob': 'Português (Brasil)', 'en': 'English', 'eng': 'English', 'es': 'Español', 'spa': 'Español'}[l] || l;
  }

  function subsItems() {
    if (REAL) return realTrackItems(2);
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
    if (REAL) return realTrackItems(1);
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
    if (k === 'playpause') { togglePause(); osd(true); renderOsd(); paintPlayer(); return; }
    if (k === 'ff' || k === 'rw') { seekBy(k === 'ff' ? 300 : -300); osd(true); renderOsd(); paintPlayer(); return; }
    if (k === 'back') {
      if (osdOn()) { osd(false); paintPlayer(); return; }
      stopPlayer(); return;
    }
    if (!osdOn()) {
      if (k === 'ok' && /\bon\b/.test(next.className)) { nextEpisode(); return; }
      if (k === 'ok' && /\bon\b/.test(skip.className) && P.seg) { P.seg.done = true; seekBy(P.seg.to - P.pos); skip.className = 'skip'; renderOsd(); paintPlayer(); return; }
      if (k === 'ok') togglePause();
      else if (k === 'left' || k === 'right') { seekBy((k === 'left' ? -1 : 1) * [10, 15, 30][SET.seek]); }
      else if (k === 'down') { openTabs(); return; }
      P.zone = k === 'up' ? 'pills' : 'bar';
      osd(true); renderOsd(); paintPlayer();
      return;
    }
    if (P.zone === 'bar') {
      if (k === 'left' || k === 'right') seekBy((k === 'left' ? -1 : 1) * [10, 15, 30][SET.seek]);
      else if (k === 'ok') togglePause();
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

  function togglePause() {
    P.paused = !P.paused;
    if (REAL) { if (P.paused) { window.Player.pause(); saveProgress(); } else window.Player.play(); }
  }
  // Seeks: the simulation moves its clock; the real player seeks.
  function seekBy(sec) {
    P.pos = Math.max(0, Math.min(P.dur - 1, P.pos + sec));
    if (REAL) window.Player.seekTo(Math.round(P.pos * 1000));
  }

  function openPlayerSources() {
    osd(true);
    openSources(P.id, P.stream, function (s) {
      if (s === P.stream) return;
      // Changing the stream in the first two minutes means the automatic choice was wrong.
      if (P.rec && now() - P.rec.at < 120000) { P.rec.kept = false; saveLog(); hud(); }
      P.stream = s; P.failedOnce = false;
      if (REAL) { openNative(P.pos); toast('Tocando ' + Ranking.label(s)); return; }
      P.started = false;
      $('#player .spinner').className = 'spinner on';
      setTimeout(function () { $('#player .spinner').className = 'spinner'; P.started = true; toast('Tocando ' + Ranking.label(s)); }, rnd(700, 1200));
    }, P.s, P.e);
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
      var still = $('#player .frame').style.backgroundImage;
      body.innerHTML = '<div class="info"><div class="thumb" style=\'background-image:' + still.replace(/'/g, '') + '\'></div><div class="text">' +
        '<div class="t1">' + esc(P.t.title) + (P.s ? ' · T' + P.s + ' E' + P.e : '') + '</div>' +
        '<div class="t3">' + metaLine(P.t) + '</div>' +
        '<div class="t2">' + esc(P.t.desc) + '</div>' +
        '<div class="t3">' + esc(Ranking.label(P.stream)) + ' · ' + esc(P.stream.group) + ' · ⚡ TorBox</div></div></div>';
    } else {
      var n = P.t.seasons[P.s - 1], h = '<div class="eps">';
      for (var e = 1; e <= n; e++) h += '<span class="' + (e === P.e ? 'on' : '') + '">' + e + '</span>';
      body.innerHTML = h + '</div>';
    }
    hud();
  }
  function tabsKey(k) {
    var max = P.s ? 1 : 0;
    if (k === 'left' && P.tab > 0) P.tab--;
    else if (k === 'right' && P.tab < max) P.tab++;
    else if (k === 'up' || k === 'back') { P.tabs = false; $('#player .tabs').className = 'tabs'; hud(); paintPlayer(); return; }
    paintTabs();
  }

  // Leaving playback opens the title's page (HIG), where Continue now carries the new position.
  function stopPlayer() {
    clearInterval(P.tick);
    if (REAL) { saveProgress(); window.Player.stop(); document.body.className = ''; }
    P.started = false;
    var c = continueOf(P.id);
    if (c) { c.posMs = P.pos * 1000; c.progress = P.pos / P.dur; c.left = Math.round((P.dur - P.pos) / 60); if (P.s) { c.s = P.s; c.e = P.e; } }
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
