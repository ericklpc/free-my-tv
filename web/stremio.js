/*
 * Stremio as the source of the Top Shelf: what you're watching (your Stremio library) and what's popular (Cinemeta).
 *  - Continue: the library items with a saved position, newest first. Needs the account's authKey (CONFIG.stremioAuthKey).
 *  - Movies and Shows: Cinemeta's "top" catalogs, the same ones Stremio's Board shows. No key needed.
 *  - Art: metahub, Stremio's image service, by IMDb id (background, logo, poster).
 * In a desktop browser a small sample stands in until the real lists arrive, so the screen can be previewed.
 * Plain ES5, like the rest of web/.
 */
var Stremio = (function () {
  'use strict';

  var API = 'https://api.strem.io/api/';
  var CINEMETA = 'https://v3-cinemeta.strem.io';
  var IMAGES = 'https://images.metahub.space/';
  var AUTH = (window.CONFIG && CONFIG.stremioAuthKey || '').trim();
  var SIZE = 20;

  var lists = {continue: [], movie: [], series: []};
  var listeners = [];
  var loadedAt = 0;

  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function request(method, url, body, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open(method, url, true);
    x.timeout = 12000;
    if (body) x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status < 200 || x.status >= 300) { done(new Error('HTTP ' + x.status)); return; }
      try { done(null, JSON.parse(x.responseText)); } catch (e) { done(e); }
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send(body ? JSON.stringify(body) : null);
  }

  function year(m) { return (m.releaseInfo || m.year || '').toString().replace(/[–-]$/, '–'); }

  /** A Cinemeta meta → what the screen shows. */
  function fromMeta(m, type) {
    return {
      id: m.imdb_id || m.id, type: type, title: m.name, year: year(m),
      genres: (m.genres || []).slice(0, 2), rating: m.imdbRating || '',
      description: m.description || '', runtime: m.runtime || ''
    };
  }

  /** A library item with a saved position → a "continue" entry. */
  function fromLibrary(it) {
    var s = it.state || {}, v = s.video_id || '', ep = /:(\d+):(\d+)$/.exec(v);
    var left = s.duration ? Math.max(0, Math.round((s.duration - s.timeOffset) / 60000)) : 0;
    return {
      id: it._id, type: it.type, title: it.name, year: '', genres: [], rating: '', description: '',
      progress: s.duration ? Math.min(1, s.timeOffset / s.duration) : 0,
      season: ep ? +ep[1] : 0, episode: ep ? +ep[2] : 0, left: left,
      video: v, at: Date.parse(s.lastWatched || it._mtime) || 0
    };
  }

  function loadCatalog(type) {
    request('GET', CINEMETA + '/catalog/' + type + '/top.json', null, function (err, o) {
      if (err || !o || !o.metas) return;
      lists[type] = o.metas.slice(0, SIZE).map(function (m) { return fromMeta(m, type); });
      changed();
    });
  }

  function loadLibrary() {
    if (!AUTH) return;
    request('POST', API + 'datastoreGet', {authKey: AUTH, collection: 'libraryItem', all: true}, function (err, o) {
      var items = !err && o && o.result;
      if (!items) return;
      lists['continue'] = items.filter(function (it) {
        return !it.removed && it.state && it.state.timeOffset > 0 && (it.type === 'movie' || it.type === 'series');
      }).map(fromLibrary).sort(function (a, b) { return b.at - a.at; }).slice(0, SIZE).map(withDetails);
      changed();
      lists['continue'].forEach(function (p) { if (!p.description) loadDetails(p); });
    });
  }

  // The library only knows names: the year, genres, rating and synopsis come from Cinemeta, once per title.
  var details = {};

  function withDetails(p) {
    var d = details[p.id];
    if (!d) return p;
    var out = {};
    for (var k in p) out[k] = p[k];
    out.year = d.year; out.genres = d.genres; out.rating = d.rating; out.description = d.description;
    return out;
  }

  function loadDetails(p) {
    if (details[p.id]) return;
    request('GET', CINEMETA + '/meta/' + p.type + '/' + p.id + '.json', null, function (err, o) {
      if (err || !o || !o.meta) return;
      details[p.id] = fromMeta(o.meta, p.type);
      // A new object for the changed title, so the screen sees it changed.
      lists['continue'] = lists['continue'].map(function (x) { return x.id === p.id ? withDetails(x) : x; });
      changed();
    });
  }

  // MARK: - Sample, for the preview and the first seconds offline

  var SAMPLE = {
    'continue': [
      ['tt11280740', 'series', 'Ruptura', 0.64, 2, 7, 'Funcionários da Lumon passam por um procedimento que separa as memórias do trabalho das da vida pessoal.', '2022–', ['Drama', 'Suspense'], '8.7'],
      ['tt14452776', 'series', 'O Urso', 0.3, 4, 3, 'Um chef jovem volta a Chicago para tocar a lanchonete da família.', '2022–', ['Comédia', 'Drama'], '8.5'],
      ['tt14961016', 'movie', 'Ainda Estou Aqui', 0.82, 0, 0, 'Eunice Paiva reconstrói a vida da família depois do desaparecimento do marido durante a ditadura.', '2024', ['Drama', 'Biografia'], '8.2'],
      ['tt22202452', 'series', 'Pluribus', 0.15, 1, 4, 'A pessoa mais infeliz da Terra precisa salvar o mundo da felicidade.', '2025–', ['Ficção científica', 'Drama'], '8.1']
    ],
    movie: [
      ['tt15239678', 'Duna: Parte Dois', '2024', ['Ficção científica', 'Aventura'], '8.5', 'Paul Atreides se une aos Fremen enquanto busca vingança contra quem destruiu sua família.'],
      ['tt31193180', 'Pecadores', '2025', ['Terror', 'Drama'], '7.7', 'Irmãos gêmeos voltam à cidade natal para recomeçar e encontram um mal ainda maior.'],
      ['tt30144839', 'Uma Batalha Após a Outra', '2025', ['Ação', 'Comédia'], '8.1', 'Um ex-revolucionário volta à ativa quando a filha some e um velho inimigo reaparece.'],
      ['tt16311594', 'F1', '2025', ['Ação', 'Drama'], '7.7', 'Um piloto veterano volta à Fórmula 1 para guiar um novato numa equipe à beira do fim.'],
      ['tt20215234', 'Conclave', '2024', ['Suspense', 'Drama'], '7.4', 'Um cardeal conduz a escolha do novo papa e descobre segredos que podem abalar a Igreja.'],
      ['tt15398776', 'Oppenheimer', '2023', ['Biografia', 'Drama'], '8.3', 'A história do físico que liderou o projeto da bomba atômica.']
    ],
    series: [
      ['tt3581920', 'The Last of Us', '2023–', ['Drama', 'Ação'], '8.6', 'Joel e Ellie atravessam um país devastado por uma pandemia de fungos.'],
      ['tt31938062', 'The Pitt', '2025–', ['Drama'], '8.8', 'Um plantão de 15 horas num pronto-socorro de Pittsburgh, hora a hora.'],
      ['tt9253284', 'Andor', '2022–2025', ['Ficção científica', 'Ação'], '8.6', 'Cassian Andor vira peça central na formação da Aliança Rebelde.'],
      ['tt13443470', 'Wandinha', '2022–', ['Comédia', 'Fantasia'], '8.0', 'Wandinha Addams investiga uma série de assassinatos na Escola Nunca Mais.'],
      ['tt4574334', 'Stranger Things', '2016–2025', ['Drama', 'Fantasia'], '8.7', 'Em Hawkins, um grupo de amigos enfrenta forças sobrenaturais.']
    ]
  };

  function sample() {
    lists['continue'] = SAMPLE['continue'].map(function (s) {
      var it = {_id: s[0], type: s[1], name: s[2], state: {timeOffset: s[3] * 3600000, duration: 3600000,
        video_id: s[4] ? s[0] + ':' + s[4] + ':' + s[5] : s[0]}};
      var c = fromLibrary(it);
      c.description = s[6]; c.year = s[7]; c.genres = s[8]; c.rating = s[9];
      return c;
    });
    ['movie', 'series'].forEach(function (type) {
      lists[type] = SAMPLE[type].map(function (s) {
        return {id: s[0], type: type, title: s[1], year: s[2], genres: s[3], rating: s[4], description: s[5]};
      });
    });
  }

  if (TV.name === 'browser') sample();   // on a TV, only real data: an empty row beats made-up progress

  return {
    /** "continue", "movie" or "series". */
    list: function (kind) { return lists[kind] || []; },
    hasAccount: function () { return !!AUTH; },
    onChange: function (f) { listeners.push(f); },

    /** Fresh lists: the library every 2 minutes (or right away when `now`, e.g. back from watching), the catalogs too. */
    refresh: function (now) {
      if (!now && Date.now() - loadedAt < 2 * 60000) return;
      loadedAt = Date.now();
      loadLibrary();
      loadCatalog('movie');
      loadCatalog('series');
    },

    background: function (p) { return IMAGES + 'background/large/' + p.id + '/img'; },
    logo: function (p) { return IMAGES + 'logo/medium/' + p.id + '/img'; },
    poster: function (p) { return IMAGES + 'poster/medium/' + p.id + '/img'; },

    /** Stremio's own link to the title (and, when resuming, straight to the episode). */
    link: function (p) {
      var video = p.video && p.video !== p.id ? p.video : p.id;
      return 'stremio:///detail/' + p.type + '/' + p.id + '/' + encodeURIComponent(video);
    },

    /** The line under the title: year and genres (the episode and the time left go on the button). */
    meta: function (p) {
      var parts = [];
      if (p.year) parts.push(p.year);
      for (var i = 0; i < p.genres.length; i++) parts.push(p.genres[i]);
      return parts;
    }
  };
})();
