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
    if (s.hdr.indexOf('DV') >= 0 && s.hdr.indexOf('HDR10') < 0) return 'Só Dolby Vision (perfil ' + (s.dvProfile || 5) + '): a TV não exibe';
    if (s.mbps > caps.maxMbps) return Math.round(s.mbps) + ' Mbps: acima do que o Wi-Fi aguenta';
    if (caps.limit && s.res > caps.limit) return 'Acima da qualidade máxima dos Ajustes';
    return '';
  }

  function score(s, caps) {
    var p = 0;
    p += Math.min(s.res, caps.maxHeight) / 10;            // 1080p and 2160p tie on a 1080p TV
    if (s.res > caps.maxHeight) p -= 4;                   // and the smaller file wins the tie
    var hw = false, soft = false;
    for (var i = 0; i < s.audio.length; i++) {
      var k = audioKind(s.audio[i]);
      if (caps.audioHw.indexOf(k) >= 0) hw = true; else soft = true;
    }
    p += hw ? 30 : soft ? -25 : -60;                      // DTS/TrueHD only: ffmpeg works, but costs CPU and TTFF
    if (s.pt) p += caps.ptAudio ? 40 : 18;
    p -= Math.abs(s.mbps - 12) * 0.8;                     // 8–16 Mbps starts fast and looks good at 1080p
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

  return {rank: rank, label: label, resLabel: resLabel, audioKind: audioKind};
})();
