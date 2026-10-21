/*
 * Picks the stream to play from what AIOStreams returns, for what this TV can actually play.
 * AIOStreams already sorts (cached first, Erick's SEL setup); this pass only removes what the TV can't play and
 * reorders for this screen and this Wi-Fi. The Android app will port this file as it is.
 *  1. Out: not cached in the debrid, AV1, Dolby Vision without an HDR10 base layer (profile 5), 3D, and anything
 *     above the Wi-Fi's budget.
 *  2. Score: resolution up to the TV's (2160p on a 1080p TV is fine, not better), audio the stick decodes in
 *     hardware, Portuguese audio or subtitles, a bitrate near the sweet spot, a good source.
 */
var Ranking = (function () {
  'use strict';

  function audioKind(a) {
    if (/TrueHD/i.test(a)) return 'TrueHD';
    if (/DTS/i.test(a)) return 'DTS';
    if (/DD\+|E-?AC-?3/i.test(a)) return 'DD+';
    if (/DD|AC-?3/i.test(a)) return 'DD';
    if (/AAC/i.test(a)) return 'AAC';
    if (/Opus/i.test(a)) return 'Opus';
    return 'other';
  }

  /** Why the TV can't play this stream, or '' when it can. */
  function blocked(s, caps) {
    if (!s.cached) return 'Não está no cache do TorBox';
    if (s.codec === 'AV1' && !caps.av1) return 'AV1: o stick não decodifica';
    if (caps.audioNone && s.audio.length) {             // Samsung: no DTS or TrueHD decoder at all
      var none = true;
      for (var i = 0; i < s.audio.length; i++) if (caps.audioNone.indexOf(audioKind(s.audio[i])) < 0) none = false;
      if (none) return 'Áudio ' + audioKind(s.audio[0]) + ': a TV não decodifica';
    }
    if (s.hdr.indexOf('DV') >= 0 && s.hdr.indexOf('HDR10') < 0) return 'Só Dolby Vision (perfil ' + (s.dvProfile || 5) + '): a TV não exibe';
    if (s.mbps && s.mbps > caps.maxMbps) return Math.round(s.mbps) + ' Mbps: acima do que o Wi-Fi aguenta';
    if (caps.limit && s.res > caps.limit) return 'Acima da qualidade máxima dos Ajustes';
    return '';
  }

  function score(s, caps) {
    var p = 0;
    p += Math.min(s.res, caps.maxHeight) / 10;            // 1080p and 2160p tie on a 1080p TV
    if (s.res > caps.maxHeight) p -= 30;                  // a 4K file on a 1080p TV: twice the data, slower start, same picture
    var hw = false, soft = false;
    for (var i = 0; i < s.audio.length; i++) {
      var k = audioKind(s.audio[i]);
      if (caps.audioHw.indexOf(k) >= 0) hw = true; else soft = true;
    }
    p += hw ? 30 : soft ? -25 : -60;                      // DTS/TrueHD only: ffmpeg works, but costs CPU and TTFF
    if (s.pt) p += caps.ptAudio ? 40 : 18;
    var mbps = s.mbps || (s.gb ? s.gb * 8192 / 7200 : 12);  // unknown bitrate: from the size, as if 2 hours long
    var aim = caps.maxHeight >= 2160 ? 25 : 12;           // 8–16 Mbps starts fast and looks good at 1080p; 4K wants more
    p -= Math.abs(mbps - aim) * 0.8;
    p += /REMUX/.test(s.source) ? 2 : /BluRay/.test(s.source) ? 6 : /WEB-DL/.test(s.source) ? 5 : 0;
    if (s.hdr.indexOf('HDR10') >= 0) p += caps.preferSdr ? -20 : 3;
    return p;
  }

  /** {play: [best first], out: [{stream, why}]} */
  function rank(list, caps) {
    var play = [], out = [];
    for (var i = 0; i < list.length; i++) {
      var why = blocked(list[i], caps);
      if (why) out.push({stream: list[i], why: why});
      else { list[i].score = score(list[i], caps); play.push(list[i]); }
    }
    play.sort(function (a, b) { return b.score - a.score; });
    return {play: play, out: out};
  }

  function resLabel(r) { return r >= 2160 ? '4K' : r + 'p'; }

  /** One line for the menu and the details page: "4K · HDR10 · DD+ 5.1 · 15,8 GB". */
  function label(s) {
    var parts = [resLabel(s.res)];
    if (s.hdr.length) parts.push(s.hdr.join(' + '));
    parts.push(s.audio[0]);
    parts.push(String(s.gb).replace('.', ',') + ' GB');
    return parts.join(' · ');
  }

  /**
   * An AIOStreams stream (its name and description, whatever the formatter) → the fields above, plus what the
   * player needs (url, bingeGroup, file name, size). Tags are read as words, so it works with other formatters too.
   */
  function parse(st) {
    var h = st.behaviorHints || {}, text = (st.name || '') + '\n' + (st.description || st.title || '') + '\n' + (h.filename || '');
    var res = /2160p|\b4K\b|UHD/i.test(text) ? 2160 : /1080p/i.test(text) ? 1080 : /720p/i.test(text) ? 720 : /480p|\bSD\b/i.test(text) ? 480 : 1080;
    var hdr = [];
    if (/\bDV\b|Dolby ?Vision|\bDoVi\b/i.test(text)) hdr.push('DV');
    if (/HDR10\+/i.test(text)) hdr.push('HDR10+');
    if (/HDR10(?!\+)|\bHDR\b/i.test(text)) hdr.push('HDR10');
    var audio = [], tags = [['TrueHD', /TrueHD/i], ['DTS-HD MA', /DTS-HD ?MA/i], ['DTS:X', /DTS[:-]?X/i], ['DTS', /\bDTS\b(?!-HD|:X)/i],
      ['DD+', /DD\+|DDP|E-?AC-?3/i], ['DD', /\bDD\b(?!\+)|\bAC-?3\b/i], ['AAC', /\bAAC\b/i], ['Opus', /\bOpus\b/i]];
    var ch = /\b([257]\.[01])\b/.exec(text), atmos = /Atmos/i.test(text);
    for (var i = 0; i < tags.length; i++) if (tags[i][1].test(text)) audio.push(tags[i][0] + (atmos && i < 5 ? ' Atmos' : '') + (ch ? ' ' + ch[1] : ''));
    if (!audio.length) audio.push('Áudio ' + (ch ? ch[1] : ''));
    var size = /([\d.,]+)\s*(GB|MB)\b/i.exec(text), gb = size ? parseFloat(size[1].replace(',', '.')) / (/MB/i.test(size[2]) ? 1024 : 1) : (h.videoSize || 0) / 1073741824;
    var rate = /([\d.,]+)\s*Mbps/i.exec(text);
    var group = /-([A-Za-z0-9]+)(?:\.\w{2,4})?$/.exec(h.filename || '') || /·\s*([A-Za-z0-9]+)\s*$/m.exec(text);
    return {
      res: res, hdr: hdr, audio: audio, gb: Math.round(gb * 10) / 10,
      mbps: rate ? parseFloat(rate[1].replace(',', '.')) : 0,
      codec: /AV1/i.test(text) ? 'AV1' : /HEVC|[xh]\.?265/i.test(text) ? 'HEVC' : /AVC|[xh]\.?264/i.test(text) ? 'AVC' : '',
      source: /REMUX/i.test(text) ? 'BluRay REMUX' : /Blu-?Ray|BDRip/i.test(text) ? 'BluRay' : /WEB-?DL/i.test(text) ? 'WEB-DL' : /WEB-?Rip/i.test(text) ? 'WEBRip' : '',
      cached: /⚡|\+\]|cached/i.test(st.name || '') || /⚡/.test(text),
      pt: /🇧🇷|\bPT-?BR\b|Portugu[eê]s|\bPOR\b|\bPT\b/i.test(text),
      group: group ? group[1] : '', url: st.url, bingeGroup: h.bingeGroup || '', filename: h.filename || '',
      videoHash: h.videoHash || '', videoSize: h.videoSize || 0, raw: st
    };
  }

  return {rank: rank, label: label, resLabel: resLabel, audioKind: audioKind, parse: parse};
})();
