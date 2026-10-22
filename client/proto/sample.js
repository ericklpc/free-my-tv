/*
 * Sample data for the prototype: real titles (TMDB and IMDb ids) with made-up progress, picks and streams.
 * With a TMDB key in config.properties the art (backdrops, title logos in Portuguese, episode stills) comes from
 * TMDB; without it each title gets a gradient in its own colors. The streams follow what Erick's AIOStreams returns
 * (resolution, cached, codec, HDR, audio, size, bitrate) for the ranking to work on.
 */
var SAMPLE = (function () {
  'use strict';

  // What the TV measured over adb (2026-10-21): Fire TV Stick 4K (2018) on a 1080p HDR10 TV, stereo PCM out.
  var CAPS = {
    device: 'Fire TV Stick 4K (2018) · TV 1080p HDR10',
    maxHeight: 1080,            // the TV's highest mode; 2160p still decodes and gets scaled down
    hdr: ['HDR10'],             // no Dolby Vision, no HLG on the TV side
    av1: false,
    audioHw: ['AAC', 'DD', 'DD+', 'Opus', 'MP3'],
    audioSoft: ['DTS', 'DTS-HD', 'DTS-HD MA', 'DTS:X', 'TrueHD'],   // ffmpeg in the player, to stereo PCM
    passthrough: false,
    maxMbps: 30                 // 2.4 GHz Wi-Fi: keep headroom
  };

  var T = {};
  function t(o) { T[o.id] = o; return o; }

  t({id: 'tt0816692', tmdb: 157336, type: 'movie', title: 'Interestelar', year: 2014, runtime: 169,
     genres: ['Ficção científica', 'Drama'], director: 'Christopher Nolan', dop: 'Hoyte van Hoytema', rating: '8,7',
     cert: '12', colors: ['#1b2a3a', '#0a0f16'],
     desc: 'Com a Terra morrendo, um ex-piloto lidera uma missão através de um buraco de minhoca em busca de um novo lar para a humanidade.'});
  t({id: 'tt15239678', tmdb: 693134, type: 'movie', title: 'Duna: Parte Dois', year: 2024, runtime: 166,
     genres: ['Ficção científica', 'Aventura'], director: 'Denis Villeneuve', dop: 'Greig Fraser', rating: '8,5',
     cert: '14', colors: ['#5a3a1c', '#1a0f06'],
     desc: 'Paul Atreides se une aos Fremen e busca vingança contra os conspiradores que destruíram sua família.'});
  t({id: 'tt13238346', tmdb: 666277, type: 'movie', title: 'Vidas Passadas', year: 2023, runtime: 106,
     genres: ['Drama', 'Romance'], director: 'Celine Song', dop: 'Shabier Kirchner', rating: '7,8',
     cert: '12', colors: ['#3c4a5c', '#12161c'],
     desc: 'Dois amigos de infância se reencontram em Nova York, duas décadas depois de se separarem em Seul.'});
  t({id: 'tt17009710', tmdb: 915935, type: 'movie', title: 'Anatomia de uma Queda', year: 2023, runtime: 151,
     genres: ['Drama', 'Suspense'], director: 'Justine Triet', dop: 'Simon Beaufils', rating: '7,7',
     cert: '14', colors: ['#c8c4bc', '#2a2a28'],
     desc: 'Uma escritora é acusada da morte do marido, e o julgamento desmonta o casamento diante do filho.'});
  t({id: 'tt27503384', tmdb: 976893, type: 'movie', title: 'Dias Perfeitos', year: 2023, runtime: 124,
     genres: ['Drama'], director: 'Wim Wenders', dop: 'Franz Lustig', rating: '7,9', cert: 'L',
     colors: ['#2f4a3a', '#0d1611'],
     desc: 'Hirayama limpa banheiros públicos em Tóquio e encontra beleza na rotina, nas árvores e nas fitas cassete.'});
  t({id: 'tt7160372', tmdb: 467244, type: 'movie', title: 'Zona de Interesse', year: 2023, runtime: 105,
     genres: ['Drama', 'Guerra'], director: 'Jonathan Glazer', dop: 'Łukasz Żal', rating: '7,4', cert: '14',
     colors: ['#4a5a3a', '#121610'],
     desc: 'O comandante de Auschwitz e a esposa constroem uma vida de sonho numa casa ao lado do campo.'});
  t({id: 'tt19770238', tmdb: 965150, type: 'movie', title: 'Aftersun', year: 2022, runtime: 102,
     genres: ['Drama'], director: 'Charlotte Wells', dop: 'Gregory Oke', rating: '7,6', cert: '14',
     colors: ['#2a6a8a', '#0a1a24'],
     desc: 'Sophie revê as férias que passou com o pai na Turquia, aos 11 anos, e tenta entender quem ele era.'});
  t({id: 'tt15398776', tmdb: 872585, type: 'movie', title: 'Oppenheimer', year: 2023, runtime: 180,
     genres: ['Drama', 'História'], director: 'Christopher Nolan', dop: 'Hoyte van Hoytema', rating: '8,3', cert: '16',
     colors: ['#7a3a10', '#160a04'],
     desc: 'A história de J. Robert Oppenheimer e do Projeto Manhattan, da física teórica à bomba.'});
  t({id: 'tt0118694', tmdb: 843, type: 'movie', title: 'Amor à Flor da Pele', year: 2000, runtime: 98,
     genres: ['Drama', 'Romance'], director: 'Wong Kar-wai', dop: 'Christopher Doyle', rating: '8,1', cert: '12',
     colors: ['#7a1a1a', '#1a0505'],
     desc: 'Hong Kong, 1962: dois vizinhos descobrem que seus cônjuges têm um caso, e se aproximam devagar.'});
  t({id: 'tt0087884', tmdb: 655, type: 'movie', title: 'Paris, Texas', year: 1984, runtime: 145,
     genres: ['Drama'], director: 'Wim Wenders', dop: 'Robby Müller', rating: '8,1', cert: '12',
     colors: ['#8a2a1a', '#1a0a06'],
     desc: 'Travis reaparece no deserto depois de quatro anos sumido e tenta reencontrar o filho e a mulher.'});
  t({id: 'tt0079944', tmdb: 1398, type: 'movie', title: 'Stalker', year: 1979, runtime: 162,
     genres: ['Ficção científica', 'Drama'], director: 'Andrei Tarkovsky', dop: 'Aleksandr Knyazhinsky', rating: '8,0',
     cert: '12', colors: ['#5a5a3a', '#14140c'],
     desc: 'Um guia leva um escritor e um cientista pela Zona, onde um quarto realizaria o desejo mais íntimo de quem entra.'});
  t({id: 'tt0109424', tmdb: 11104, type: 'movie', title: 'Amores Expressos', year: 1994, runtime: 102,
     genres: ['Drama', 'Romance'], director: 'Wong Kar-wai', dop: 'Christopher Doyle', rating: '8,0', cert: '14',
     colors: ['#1a6a5a', '#06161a'],
     desc: 'Dois policiais de Hong Kong, dois corações partidos, uma lanchonete e California Dreamin’ no repeat.'});
  t({id: 'tt28607951', tmdb: 1064213, type: 'movie', title: 'Anora', year: 2024, runtime: 139,
     genres: ['Comédia', 'Drama'], director: 'Sean Baker', dop: 'Drew Daniels', rating: '7,4', cert: '18',
     colors: ['#7a2a5a', '#1a0816'],
     desc: 'Uma dançarina do Brooklyn se casa por impulso com o filho de um oligarca russo, e a família dele vem desfazer o casamento.'});
  t({id: 'tt8999762', tmdb: 549509, type: 'movie', title: 'O Brutalista', year: 2024, runtime: 215,
     genres: ['Drama'], director: 'Brady Corbet', dop: 'Lol Crawley', rating: '7,4', cert: '16',
     colors: ['#5a4a3a', '#14100c'],
     desc: 'Um arquiteto húngaro sobrevivente do Holocausto recomeça nos Estados Unidos sob a proteção de um milionário.'});
  t({id: 'tt14961016', tmdb: 1000837, type: 'movie', title: 'Ainda Estou Aqui', year: 2024, runtime: 137,
     genres: ['Drama', 'História'], director: 'Walter Salles', dop: 'Adrian Teijido', rating: '8,0', cert: '14',
     colors: ['#3a5a6a', '#0c1418'],
     desc: 'Rio, 1971: Eunice Paiva reconstrói a família depois que o marido, o ex-deputado Rubens Paiva, é levado pela ditadura.'});
  t({id: 'tt0046438', tmdb: 18148, type: 'movie', title: 'Era uma Vez em Tóquio', year: 1953, runtime: 136,
     genres: ['Drama'], director: 'Yasujirō Ozu', dop: 'Yūharu Atsuta', rating: '8,1', cert: 'L',
     colors: ['#6a6a5a', '#181814'],
     desc: 'Um casal de idosos visita os filhos em Tóquio e descobre que eles mal têm tempo para os pais.'});
  t({id: 'tt0056801', tmdb: 422, type: 'movie', title: '8½', year: 1963, runtime: 138,
     genres: ['Drama'], director: 'Federico Fellini', dop: 'Gianni Di Venanzo', rating: '8,0', cert: '14',
     colors: ['#5a5a5a', '#101010'],
     desc: 'Um cineasta em crise criativa se refugia em memórias, sonhos e nas mulheres da sua vida.'});
  t({id: 'tt0055852', tmdb: 499, type: 'movie', title: 'Cléo das 5 às 7', year: 1962, runtime: 90,
     genres: ['Drama'], director: 'Agnès Varda', dop: 'Jean Rabier', rating: '7,8', cert: '12',
     colors: ['#4a4a4a', '#0e0e0e'],
     desc: 'Duas horas na vida de uma cantora que vaga por Paris à espera do resultado de um exame.'});
  t({id: 'tt0244316', tmdb: 25538, type: 'movie', title: 'As Coisas Simples da Vida', year: 2000, runtime: 173,
     genres: ['Drama'], director: 'Edward Yang', dop: 'Yang Wei-han', rating: '8,1', cert: '12',
     colors: ['#2a4a5a', '#081014'],
     desc: 'Um ano na vida de uma família de Taipé, de um casamento a um funeral, pelos olhos do pai e do filho caçula.'});
  t({id: 'tt0100234', tmdb: 30017, type: 'movie', title: 'Close-Up', year: 1990, runtime: 98,
     genres: ['Drama', 'Documentário'], director: 'Abbas Kiarostami', dop: 'Ali Reza Zarrindast', rating: '8,2', cert: 'L',
     colors: ['#5a5a3a', '#16160c'],
     desc: 'Kiarostami reconstrói, com as pessoas reais, a história de um homem que se fez passar pelo cineasta Makhmalbaf.'});
  t({id: 'tt11280740', tmdb: 95396, type: 'series', title: 'Ruptura', year: 2022, genres: ['Drama', 'Mistério'],
     rating: '8,7', cert: '16', colors: ['#1a3a5a', '#060e16'], seasons: [9, 10],
     desc: 'Funcionários da Lumon passam por uma cirurgia que separa as memórias do trabalho das da vida pessoal.'});
  t({id: 'tt14452776', tmdb: 136315, type: 'series', title: 'O Urso', year: 2022, genres: ['Comédia', 'Drama'],
     rating: '8,5', cert: '16', colors: ['#4a3a2a', '#100c08'], seasons: [8, 10, 10, 10],
     desc: 'Um chef premiado volta a Chicago para salvar a lanchonete da família depois de uma tragédia.'});
  t({id: 'tt2788316', tmdb: 126308, type: 'series', title: 'Xógum', year: 2024, genres: ['Drama', 'História'],
     rating: '8,6', cert: '16', colors: ['#3a1a1a', '#0e0606'], seasons: [10],
     desc: 'Japão, 1600: um navegador inglês naufraga e se vê no meio da disputa pelo poder entre senhores feudais.'});
  t({id: 'tt9253284', tmdb: 83867, type: 'series', title: 'Andor', year: 2022, genres: ['Ficção científica', 'Drama'],
     rating: '8,6', cert: '14', colors: ['#3a3a3a', '#0c0c0c'], seasons: [12, 12],
     desc: 'Cassian Andor, um ladrão sem causa, vira a primeira faísca da rebelião contra o Império.'});

  // Rows in the order the Apple TV app's Home uses: what you're in the middle of first, then picks, then charts
  // and themed collections. Each `why` is the weekly pick's one-line case, written from Erick's ratings.
  var HOME = {
    hero: [
      {id: 'tt27503384', kicker: 'Curadoria da semana', why: 'Wenders de novo com a mesma calma de Paris, Texas, que você deu 5★.'},
      {id: 'tt15239678', kicker: 'Lançamento', why: 'Greig Fraser na fotografia; você deu 4,5★ pro primeiro.'},
      {id: 'tt11280740', kicker: 'Nova temporada', why: 'A 2ª temporada inteira já está no TorBox.'},
      {id: 'tt0079944', kicker: 'Clássico que você não viu', why: 'Você deu 5★ pra Solaris e salvou O Espelho na watchlist.'}
    ],
    rows: [
      {kind: 'continue', title: 'Continuar assistindo', items: [
        {id: 'tt11280740', s: 2, e: 4, progress: 0.62, left: 19},
        {id: 'tt0816692', progress: 0.38, left: 104},
        {id: 'tt14452776', s: 3, e: 1, progress: 0, next: true},
        {id: 'tt2788316', s: 1, e: 7, progress: 0.15, left: 52}
      ]},
      // The weekly picks: a mix of new releases and classics, with three views (all, new, classics).
      {kind: 'picks', title: 'Escolhidos pra você', subtitle: 'Toda segunda, a partir das suas notas', items: [
        {id: 'tt27503384', why: 'Wenders de novo, na mesma calma de Paris, Texas.'},
        {id: 'tt0046438', why: 'Ozu, a matriz de Dias Perfeitos e de tudo que você deu 5★ em plano fixo.'},
        {id: 'tt14961016', why: 'Walter Salles contido como em Central do Brasil, que você deu 4,5★.'},
        {id: 'tt0109424', why: 'Doyle e Wong Kar-wai, a dupla do seu 5★ em Amor à Flor da Pele.'},
        {id: 'tt0055852', why: 'Varda e o tempo real, perto da Nouvelle Vague da sua lista.'},
        {id: 'tt19770238', why: 'Memória e silêncio, como Vidas Passadas, que você deu 4,5★.'},
        {id: 'tt0244316', why: 'Edward Yang: família filmada de longe, como você gosta em Kore-eda.'},
        {id: 'tt28607951', why: 'Sean Baker: você deu 4★ pra Projeto Flórida.'},
        {id: 'tt0100234', why: 'Kiarostami entre ficção e documentário, como Close-Up pede.'},
        {id: 'tt7160372', why: 'Fora de campo como em Anatomia de uma Queda.'},
        {id: 'tt0056801', why: 'Fellini: você salvou A Doce Vida na watchlist.'},
        {id: 'tt8999762', why: 'Fotografia em VistaVision, de quem notou Hoyte van Hoytema.'},
        {id: 'tt0079944', why: 'Tarkovsky: você deu 5★ pra Solaris.'}
      ]},
      // Dynamic lists. `source` says where the real list comes from; `items` stand in until it arrives (or
      // when the source can't be reached, like in a browser preview without keys).
      {kind: 'chart', title: 'Top 10 no Brasil', source: {tmdb: 'movie/popular?region=BR'}, limit: 10, items: [
        {id: 'tt15239678'}, {id: 'tt14961016'}, {id: 'tt15398776'}, {id: 'tt2788316'}, {id: 'tt0816692'},
        {id: 'tt13238346'}, {id: 'tt28607951'}, {id: 'tt14452776'}, {id: 'tt17009710'}, {id: 'tt9253284'}
      ]},
      {kind: 'wide', title: 'Em alta esta semana', source: {tmdb: 'trending/all/week'}, items: [
        {id: 'tt28607951'}, {id: 'tt8999762'}, {id: 'tt15239678'}, {id: 'tt11280740'}, {id: 'tt14452776'}
      ]},
      {kind: 'poster', title: 'Novos nos cinemas do Brasil', source: {tmdb: 'movie/now_playing?region=BR'}, items: [
        {id: 'tt14961016'}, {id: 'tt8999762'}, {id: 'tt28607951'}, {id: 'tt15239678'}
      ]},
      {kind: 'wide', title: 'Populares no Stremio', source: {cinemeta: 'movie/top'}, items: [
        {id: 'tt15398776'}, {id: 'tt0816692'}, {id: 'tt15239678'}, {id: 'tt17009710'}
      ]},
      {kind: 'wide', title: 'Séries em alta', source: {cinemeta: 'series/top'}, items: [
        {id: 'tt11280740'}, {id: 'tt2788316'}, {id: 'tt14452776'}, {id: 'tt9253284'}
      ]},
      {kind: 'poster', title: 'Os mais bem avaliados', source: {tmdb: 'movie/top_rated'}, items: [
        {id: 'tt0046438'}, {id: 'tt0816692'}, {id: 'tt0118694'}, {id: 'tt0056801'}, {id: 'tt0079944'}
      ]},
      {kind: 'poster', title: 'Cinema de Hong Kong', items: [
        {id: 'tt0118694'}, {id: 'tt0109424'}
      ]},
      {kind: 'wide', title: 'Porque você deu 5★ pra Paris, Texas', items: [
        {id: 'tt27503384'}, {id: 'tt0079944'}, {id: 'tt19770238'}, {id: 'tt13238346'}, {id: 'tt0046438'}
      ]},
      {kind: 'poster', title: 'Séries mais bem avaliadas', source: {tmdb: 'tv/top_rated'}, items: [
        {id: 'tt11280740'}, {id: 'tt9253284'}, {id: 'tt2788316'}
      ]},
      {kind: 'wide', title: 'Em breve', source: {tmdb: 'movie/upcoming?region=BR'}, items: [
        {id: 'tt8999762'}, {id: 'tt14961016'}
      ]}
    ]
  };

  // Streams as AIOStreams sends them, already parsed (the app reads the same fields from `name` and
  // `description`). `fails` makes a stream break a few seconds in, to show the automatic fallback.
  function streams(id) {
    var base = [
      {res: 2160, source: 'BluRay REMUX', codec: 'HEVC', hdr: ['DV', 'HDR10'], dvProfile: 7, audio: ['TrueHD Atmos 7.1'], gb: 61.2, mbps: 58.4, cached: true, group: 'FraMeSToR'},
      {res: 2160, source: 'BluRay', codec: 'HEVC', hdr: ['HDR10'], audio: ['DTS-HD MA 5.1'], gb: 24.3, mbps: 19.2, cached: true, group: 'DreamHD'},
      {res: 2160, source: 'WEB-DL', codec: 'HEVC', hdr: ['DV'], dvProfile: 5, audio: ['DD+ Atmos 5.1'], gb: 14.1, mbps: 11.2, cached: true, group: 'FLUX'},
      {res: 2160, source: 'WEB-DL', codec: 'AV1', hdr: ['HDR10'], audio: ['Opus 5.1'], gb: 6.2, mbps: 4.9, cached: true, group: 'Tigole'},
      {res: 1080, source: 'BluRay', codec: 'AVC', hdr: [], audio: ['DD+ 5.1', 'DTS-HD MA 5.1'], gb: 23.4, mbps: 18.5, cached: true, group: 'DON', pt: true},
      {res: 2160, source: 'WEB-DL', codec: 'HEVC', hdr: ['HDR10'], audio: ['DD+ 5.1'], gb: 15.8, mbps: 12.4, cached: true, group: 'NTb', pt: true},
      {res: 1080, source: 'WEB-DL', codec: 'HEVC', hdr: [], audio: ['DD+ 5.1'], gb: 5.1, mbps: 4.1, cached: true, group: 'FLUX', pt: true},
      {res: 1080, source: 'BluRay', codec: 'AVC', hdr: [], audio: ['DTS 5.1'], gb: 11.8, mbps: 9.3, cached: true, group: 'SPARKS'},
      {res: 720, source: 'WEBRip', codec: 'AVC', hdr: [], audio: ['AAC 2.0'], gb: 1.4, mbps: 1.8, cached: true, group: 'YTS'},
      {res: 2160, source: 'BluRay', codec: 'HEVC', hdr: ['HDR10'], audio: ['DD 5.1'], gb: 25.9, mbps: 20.5, cached: false, group: 'TERMiNAL'}
    ];
    // A little variety per title, so the menu isn't the same everywhere.
    var n = 0;
    for (var i = 0; i < id.length; i++) n += id.charCodeAt(i);
    return base.filter(function (s, i) { return (i + n) % 7 !== 0; }).map(function (s) {
      var o = {}; for (var k in s) o[k] = s[k];
      // Interstellar's automatic pick breaks a few seconds in, to show the fallback.
      if (id === 'tt0816692' && o.group === 'NTb') o.fails = true;
      return o;
    });
  }

  return {caps: CAPS, titles: T, home: HOME, streams: streams};
})();
