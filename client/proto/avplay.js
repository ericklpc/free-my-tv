/*
 * Samsung TVs (Tizen): the same window.Player the Fire TV app gives the page, on Samsung's own player (AVPlay).
 * The video plays on a plane under the page, which turns see-through while it plays (body.native), so the page keeps
 * drawing the controls, the menus and the subtitles, as on the Fire TV. Events go back through Native.player:
 * ready, firstFrame, buffering, stall, error, ended, tracks, cues, warm. Only loaded in the Tizen build, and only
 * active when webapis.avplay is there.
 */
(function () {
  'use strict';
  var av = window.webapis && window.webapis.avplay;
  if (!av) return;

  var STALL_MS = 6000, START_MS = 25000;
  var S = {url: '', ready: false, preparing: false, wantPlay: false, rendered: false, openedAt: 0, start: 0,
           last: -1, lastMoved: 0, buffering: false, ext: null, cue: '', subTimer: 0, extSubs: []};

  function now() { return Date.now ? Date.now() : +new Date(); }
  function emit(o) { if (window.Native && window.Native.player) window.Native.player(o); }
  function log(m) { if (window.console) console.log('[avplay] ' + m); }

  // What the TV plays: The Frame and the other 2020+ sets decode 4K HDR10/HDR10+ and AV1, Dolby (AC-3, E-AC-3)
  // and AAC; DTS and TrueHD not at all.
  var model = '';
  try { model = webapis.productinfo.getRealModel(); } catch (e) {}
  window.PLAYER_CAPS = {
    device: 'Samsung ' + (model || 'Tizen') + ' · 4K HDR10',
    maxHeight: 2160,
    hdr: ['HDR10', 'HDR10+', 'HLG'],
    av1: true,
    audioHw: ['AAC', 'DD', 'DD+', 'MP3'],
    audioSoft: [],
    audioNone: ['DTS', 'TrueHD'],
    passthrough: false,
    maxMbps: 60
  };

  // The remote's media keys come to the page only once asked for.
  try {
    tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind',
      'MediaStop', 'Info', 'ColorF0Red']);
  } catch (e) {}

  function fit() {
    try { av.setDisplayRect(0, 0, 1920, 1080); av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
  }

  function close() {
    clearTimeout(S.subTimer);
    try { av.stop(); } catch (e) {}
    try { av.close(); } catch (e) {}
    S.url = ''; S.ready = S.preparing = S.wantPlay = S.rendered = false; S.ext = null; S.cue = ''; S.seeking = false; S.pending = null;
  }

  // MARK: - Opening: paused and out of sight (preload), or playing

  function open(o, play) {
    var start = Math.max(0, o.startMs || 0);
    S.extSubs = o.subtitles || [];
    if (play && o.url === S.url && (S.ready || S.preparing)) {
      // The title's page prepared it already: OK only presses play.
      S.openedAt = now(); S.wantPlay = true; S.rendered = false;
      if (S.ready) go(start);
      else S.start = start;
      log('open: preloaded, ' + (S.ready ? 'ready' : 'still preparing'));
      return;
    }
    close();
    S.url = o.url; S.start = start; S.wantPlay = play; S.openedAt = now(); S.preparing = true; S.last = -1;
    try {
      av.open(o.url);
      fit();
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4); } catch (e) {}
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 6); } catch (e) {}
      if (o.uhd) try { av.setStreamingProperty('SET_MODE_4K', 'TRUE'); } catch (e) {}
      av.setListener(listener);
      var url = o.url;
      av.prepareAsync(function () {
        if (S.url !== url) return;
        S.preparing = false; S.ready = true;
        emit({type: 'ready', dur: av.getDuration()});
        if (S.wantPlay) go(S.start);
        else if (S.start > 3000) try { av.seekTo(S.start); } catch (e) {}
      }, function (err) {
        if (S.url !== url) return;
        S.preparing = false;
        if (S.wantPlay) emit({type: 'error', code: String(err && err.name || err), message: 'prepare'});
      });
    } catch (e) {
      S.preparing = false;
      emit({type: 'error', code: e.name || 'OPEN', message: String(e.message || e)});
    }
  }

  function go(start) {
    var at = 0;
    try { at = av.getCurrentTime(); } catch (e) {}
    S.last = -1; S.lastMoved = now();
    var playNow = function () { try { av.play(); } catch (e) { emit({type: 'error', code: e.name || 'PLAY', message: String(e.message || e)}); } tracks(); };
    if (Math.abs(at - start) > 3000) {
      try { av.seekTo(start, playNow, playNow); } catch (e) { playNow(); }
    } else playNow();
  }

  // AVPlay refuses a seek while the last one is still going: keep only the newest target and run it after.
  function seek(ms) {
    ms = Math.max(0, ms);
    S.lastMoved = now() + 4000;
    if (S.ext) extCue(ms);
    if (S.seeking) { S.pending = ms; return; }
    S.seeking = true;
    var done = function () {
      S.seeking = false;
      if (S.pending != null) { var p = S.pending; S.pending = null; seek(p); }
    };
    try { av.seekTo(ms, done, done); } catch (e) { S.seeking = false; S.pending = null; }
  }

  var listener = {
    onbufferingstart: function () { S.buffering = true; if (S.rendered) emit({type: 'buffering'}); },
    onbufferingcomplete: function () {
      S.buffering = false; S.lastMoved = now();
      var d = 0; try { d = av.getDuration(); } catch (e) {}
      emit({type: 'ready', dur: d});            // the page takes the spinner away
    },
    oncurrentplaytime: function (ms) {
      if (!S.wantPlay) return;
      if (ms !== S.last) { S.last = ms; S.lastMoved = now(); }
      if (!S.rendered) {
        S.rendered = true;
        emit({type: 'firstFrame', ms: now() - S.openedAt});
      }
      if (S.ext) extCue(ms);
    },
    onstreamcompleted: function () { emit({type: 'ended'}); },
    onerror: function (type) { emit({type: 'error', code: String(type), message: 'avplay'}); },
    onsubtitlechange: function (duration, text) {
      if (S.ext) return;
      showCue(strip(text || ''));
      clearTimeout(S.subTimer);
      S.subTimer = setTimeout(function () { showCue(''); }, Math.max(500, +duration || 3000));
    },
    onevent: function () {},
    ondrmevent: function () {}
  };

  // A stream that stops moving for 6 s, or never starts in 25: the page moves to the next source.
  setInterval(function () {
    if (!S.wantPlay || !S.url) return;
    var state = '';
    try { state = av.getState(); } catch (e) {}
    if (!S.rendered) {
      if (now() - S.openedAt > START_MS) { emit({type: 'error', code: 'TIMEOUT', message: 'no picture in 25 s'}); S.wantPlay = false; }
      return;
    }
    if (state === 'PLAYING' && now() - S.lastMoved > STALL_MS) { S.lastMoved = now(); emit({type: 'stall', pos: S.last}); }
  }, 1000);

  // MARK: - Tracks: the file's audio and subtitles, plus OpenSubtitles' files, which the page draws itself

  function info(t) { try { return JSON.parse(t.extra_info || '{}'); } catch (e) { return {}; } }

  function tracks() {
    var all = [], cur = [], audio = [], text = [];
    try { all = av.getTotalTrackInfo() || []; } catch (e) {}
    try { cur = av.getCurrentStreamInfo() || []; } catch (e) {}
    var on = {};
    for (var c = 0; c < cur.length; c++) on[cur[c].type + cur[c].index] = true;
    for (var i = 0; i < all.length; i++) {
      var t = all[i], x = info(t);
      if (t.type === 'AUDIO') {
        var four = (x.fourCC || '').toUpperCase();
        audio.push({group: t.index, index: 0, lang: x.language || '', label: '', mime: 'audio/' + four.toLowerCase(),
          channels: +x.channels || 0, selected: !!on['AUDIO' + t.index], supported: !/DTS|TRUEHD|MLP/.test(four),
          id: 'a' + t.index, forced: false});
      } else if (t.type === 'TEXT') {
        text.push({group: t.index, index: 0, lang: x.track_lang || x.language || '', label: '', mime: 'text',
          selected: !!on['TEXT' + t.index], supported: true, id: 't' + t.index, forced: false});
      }
    }
    for (var j = 0; j < S.extSubs.length; j++) {
      var s = S.extSubs[j];
      text.push({group: 1000 + j, index: 0, lang: s.lang, label: s.label || 'OpenSubtitles', mime: 'text/srt',
        selected: false, supported: true, id: 'ext' + j, forced: false});
    }
    emit({type: 'tracks', audio: audio, text: text});
  }

  function strip(t) { return t.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\r/g, ''); }
  function showCue(t) { if (t !== S.cue) { S.cue = t; emit({type: 'cues', text: t}); } }

  function time(t) {
    var m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t) || /()(\d+):(\d+)[,.](\d+)/.exec(t);
    return m ? ((+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : 0;
  }
  function parse(text) {
    var cues = [], blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n'), k = 0;
      while (k < lines.length && lines[k].indexOf('-->') < 0) k++;
      if (k >= lines.length) continue;
      var p = lines[k].split('-->');
      cues.push({a: time(p[0]), b: time(p[1]), t: strip(lines.slice(k + 1).join('\n')).replace(/^\s+|\s+$/g, '')});
    }
    return cues;
  }
  function extCue(ms) {
    var c = S.ext.cues, t = '';
    for (var i = 0; i < c.length; i++) if (ms >= c[i].a && ms <= c[i].b) { t = c[i].t; break; }
    showCue(t);
  }
  function loadExt(j) {
    var s = S.extSubs[j], x = new XMLHttpRequest(), want = {cues: []};
    S.ext = want;
    try { av.setSilentSubtitle(true); } catch (e) {}
    x.open('GET', s.url, true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (S.ext === want) want.cues = x.status === 200 ? parse(x.responseText || '') : [];
      log('legenda externa: ' + want.cues.length + ' falas');
    };
    x.send();
  }

  function select(type, group) {
    if (type === 1) { try { av.setSelectTrack('AUDIO', group); } catch (e) { log('audio ' + e); } return; }
    clearTimeout(S.subTimer); showCue('');
    if (group < 0) { S.ext = null; try { av.setSilentSubtitle(true); } catch (e) {} return; }
    if (group >= 1000) { loadExt(group - 1000); return; }
    S.ext = null;
    try { av.setSilentSubtitle(false); av.setSelectTrack('TEXT', group); } catch (e) { log('text ' + e); }
  }

  // MARK: - Trakt and warm-up, straight from the page: a Tizen app isn't held to CORS

  function request(id, method, url, headers, body) {
    var x = new XMLHttpRequest(), h = {};
    try { h = JSON.parse(headers || '{}'); } catch (e) {}
    x.open(method, url, true);
    for (var k in h) x.setRequestHeader(k, h[k]);
    x.onreadystatechange = function () {
      if (x.readyState === 4 && window.Native && window.Native.http) window.Native.http(id, x.status, x.responseText || '');
    };
    x.send(body || null);
  }

  // The debrid makes its link on the first request: one byte ahead of time takes that off the start.
  function warm(url) {
    var x = new XMLHttpRequest(), t0 = now();
    x.open('GET', url, true);
    x.setRequestHeader('Range', 'bytes=0-0');
    x.onreadystatechange = function () {
      if (x.readyState === 4) emit({type: 'warm', url: url, ms: now() - t0, ok: x.status >= 200 && x.status < 300});
    };
    x.send();
  }

  // The TV's Home button: pause, and don't come back to a frozen picture.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.url) try { av.pause(); } catch (e) {}
  });

  window.Player = {
    open: function (json) { open(JSON.parse(json), true); },
    preload: function (json) { open(JSON.parse(json), false); },
    request: request,
    warm: warm,
    play: function () { S.lastMoved = now(); try { av.play(); } catch (e) {} },
    pause: function () { try { av.pause(); } catch (e) {} },
    seekTo: seek,
    stop: close,
    select: select,
    state: function () {
      var o = {};
      try {
        var st = av.getState();
        o = {pos: av.getCurrentTime(), dur: av.getDuration(), buffered: av.getCurrentTime(), playing: st === 'PLAYING'};
      } catch (e) {}
      return JSON.stringify(o);
    }
  };
})();
