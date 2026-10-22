# Handoff do projeto TV (Sofá)

Atualizado em 22/10/2026. Pra qualquer agente que for continuar o projeto. Nada de chave ou segredo aqui: elas
ficam só no `config.properties` do Mac do Erick.

## 1. Quem é e como trabalhar com ele

- **Erick**, designer, 28 anos, São Paulo. Fala PT-BR, tom casual, quer resposta direta ao ponto.
- Quer que as tarefas sejam **levadas até o fim** sem parar no meio ("o client tava preguiçoso"). Testa, instala e
  confirma sozinho sempre que der.
- Manda pedidos em rajada e por foto da TV. Responde curto ("pode instalar", "pode testar na frame").
- **Antes de mandar tecla, dormir/reiniciar ou reinstalar algo numa TV, confirme que ninguém tá assistindo.**
  Já interrompemos ele duas vezes. No Fire TV: `adb shell dumpsys media_session | grep state=` (state=3 = tocando).
- Mudança persistente no Mac (launchd, settings seguros, adb que escreve) precisa de **OK escrito dele na thread**;
  card de decisão não bastou pra sessão do Mac. Coisas tipo `settings put secure` / `appops` às vezes ele mesmo
  tem que rodar no Terminal.
- Permissões de TV (aceitar dispositivo, aceitar app) só ele aceita, no controle.

## 2. Objetivo

Uma "home" no visual do **app TV da Apple (tvOS)** pras TVs dele, mostrando conteúdo do **Stremio** (Continuar,
Filmes, Séries) + atalhos pra Globoplay, Prime Video, HBO Max, Apple TV e Netflix. Virou dois apps:

1. **Sofá** (launcher): a home, fork do free-my-tv. Roda no Fire TV (WebView) e na Samsung (Tizen).
2. **Sofá Player**: client próprio do Stremio no estilo tvOS (TorBox + AIOStreams), com player nativo, curadoria
   semanal a partir do Letterboxd/Trakt e métricas.

Metas do player (pedido original): TTFF < 3 s (hoje < 0,2 s), ≥ 90% de acerto na 1ª fonte automática, legenda
pt-BR > pt > en casada pelo release, fallback automático, menu de fontes num botão, continue/resume/scrobble com
Trakt, autoplay do próximo episódio, pular abertura. Validação: 2 semanas de uso real (até ~04/11/2026).

## 3. Aparelhos e rede (192.168.15.0/24)

| Aparelho | IP | Detalhes |
|---|---|---|
| Fire TV Stick 4K 1ª ger. (2018, AFTMM "mantis") | 192.168.15.22 (adb :5555) | Fire OS 6.7.1.1 = Android 7.1.2, SDK 25, armv7 32-bit. ADB ligado e autorizado no Mac. |
| Samsung The Frame QN55LS03D (2024, "sala") | 192.168.15.21 (sdb serial 192.168.15.21:26101) | Tizen 9.0 reportado. Modo desenvolvedor ligado, Host PC IP = Mac. |
| Samsung "do quarto" | **desconhecido** | Não apareceu no scan da rede. Erick reclamou que o descanso de tela liga assistindo. Falta o IP. |
| Mac do Erick ("MacBook-Pro-de-Erick-2") | 192.168.15.15 | Onde rodam build, adb, sdb, tz e o job de curadoria. |
| PC Windows "ERICK" | ? | Tem platform-tools/.sdb, não usado até agora. |

Capacidade medida (Fire TV + TV ligada nele): máx. 1080p, só HDR10 (sem DV, sem HLG), áudio só PCM estéreo (sem
passthrough). Decodifica HEVC/AVC/VP9 até 4K60 por hardware; sem AV1; AC3/E-AC3/AAC/Opus sim, DTS/TrueHD não (o
ffmpeg do Media3 decodifica em software). Wi-Fi 2,4 GHz, link 144 Mbps. Dados brutos: `~/sofa-tv/survey/` no Mac.

## 4. Repositório, branches e pastas

Repo: **github.com/ericklpc/free-my-tv** (fork MIT de simbasjungles/free-my-tv). O `CLAUDE.md` da raiz explica a
base do free-my-tv; leia antes.

| Branch | O que tem | Último commit |
|---|---|---|
| `sofa` | Launcher Sofá: `web/` (home tvOS + Stremio), `firetv/` (app Android io.sofa.firetv), `tizen/` (build Samsung) | `c907ff8` |
| `claude/project-thread-bgyc8l` | Sofá Player: `client/proto/` (UI web), `client/curation/`, `firetv/player/` (Media3), `firetv/build.sh --proto`. **PR #1 aberto → `sofa`** (mergeable). 6 commits do `sofa` ainda não estão nele. | `24def2b` |
| `claude/project-thread-5pqbf5` | `firetv/debloat.sh` (em cima do `sofa` antigo) | `acf1188` |
| `main` | free-my-tv original | |

Pastas no **Mac do Erick** (fora do portfolio):

- `~/sofa-tv`: clone do launcher (`sofa`), com `config.properties` (chaves: `tmdb_key`, `stremio_auth_key` sem
  aspas, AIOStreams manifest, etc.). `~/sofa-tv/survey/` (medições + export do Letterboxd em `survey/letterboxd`),
  `~/sofa-tv/telas/` (prints, `frame-log.jsonl`), `~/sofa-tv/frame-applist.txt`, `~/sofa-tv/criar-certificado-samsung.sh`.
- `~/sofa-player`: clone do player, em **detached HEAD** no commit que o job de curadoria roda (hoje `24def2b`).
- `~/sofa-debloat/firetv/debloat.sh` + log `debloat-192_168_15_22.log`.
- `~/tizen-studio/` (sdb em `tools/sdb`, tz em `tools/tizen-core/tz`). Perfil de certificado Samsung: **SofaTV**
  (senha é do Erick, ele digita).
- `~/.sofa-trakt.json`: token do Trakt (segredo).
- **Não mexer em `~/portfolio-v2`** (é a pasta aprovada pro acesso remoto, mas é o portfólio dele).

Pasta compartilhada do projeto (`/mnt/project-files/`): `tv-launcher/` (protótipo HTML, patch v2, telas, revisão de
design, cópia antiga do `sofa-web`), `tv-client/estudo.md` (estudo de plataforma/player), este handoff.

Protótipo publicado (antigo): https://claude.ai/artifact/XKSww9g3Qvyirt6SbnWfqt

## 5. Arquitetura

### Launcher Sofá (`sofa`)
- **`web/`**: home em ES5 + CSS sem variáveis (roda em Chromium de 2015-17). `home.js` (layout tvOS: hero com
  dots e auto play de 9 s, botão Assistir/Continuar, Top Shelf com Continuar/Filmes/Séries, fileira de apps),
  `stremio.js` (biblioteca do Stremio com `stremio_auth_key`, Continuar igual ao do Stremio, Filmes/Séries ao vivo
  do catálogo Cinemeta), `tv.js` (lado da TV: Tizen `tizen.application`, fontes; Android pela ponte
  `window.AndroidTV`), TMDB pt-BR pra título/sinopse/logos.
- **`firetv/`**: app Android `io.sofa.firetv` = WebView em tela cheia + ponte. Peças-chave:
  - `HomeWatcher`: o Fire OS 6 não deixa trocar a home nem usar acessibilidade de app sideload. O vigia consulta
    UsageStats várias vezes por segundo e, quando a home da Amazon vem pra frente, abre o Sofá. Roda em foreground
    service + alarme de 15 min pra voltar se o LMK matar; ao ligar a tela (SCREEN_ON) também abre o Sofá.
  - Tela de carregamento (overlay SYSTEM_ALERT_WINDOW) cobre a home da Amazon nos ~5 s de atraso do Android.
  - Permissões dadas uma vez por adb: `appops set io.sofa.firetv GET_USAGE_STATS allow` e `SYSTEM_ALERT_WINDOW allow`.
  - Títulos e o bloco do Stremio abrem no **Sofá Player** (`io.sofa.player`, `sofa://`) quando instalado.
  - Banners dos apps inteiros num bloco 16:9 com a cor da borda; lista de apps e listas do Stremio em cache pra
    abrir rápido (1º desenho ~2,3 s, página cheia ~4,5 s).
- **`tizen/`**: `python3 tizen/build.py --sign SofaTV` → `Sofa-Launcher-tizen.wgt`, app id **`SofaLaunch.Sofa`**,
  nome "Sofá". Bloco "TV ao vivo" (`source:TV:1`) logo depois do 1º app. Modo Arte **não** tem bloco (Erick usa o
  botão de desligar). Entre apps Samsung de mesmo nome, escolhe o que tem ícone próprio. `debug_log=<url>` opcional
  no config manda logs da TV pro coletor do Mac (porta 8799).

### Sofá Player (`claude/project-thread-bgyc8l`)
- UI web em `client/proto/` (mesmas regras ES5 do `web/`), com `ranking.js` (descarta não-cacheado no TorBox, AV1,
  DV perfil 5, > ~30 Mbps; prefere 1080p, DD/DD+/AAC, áudio/legenda PT).
- **Fire TV**: player nativo **Media3 1.7.1 + ffmpeg da Jellyfin 1.6.1+2**, dexado com o D8 do R8 (o d8 do
  build-tools 34 quebra). Um ExoPlayer novo por stream (o decoder Dolby do stick falha no flush). Preload pausado
  atrás da página → TTFF < 0,1 s do OK. `Loudness.java`: nivelador suave (±8 dB).
- **Samsung**: `avplay.js` (AVPlay). App id **`SofaPlayer.Sofa`** (Samsung lista como
  `SofaPlayer.Sofa-Player-tizen-signed`; **mantenha esse nome de arquivo**, o Tizen deriva o id dele). Abre título
  pedido por appcontrol (`sofa://detail/...` ou `stremio:///`). Volume automático: no Tizen o app não mexe no som,
  então é o ajuste da TV (Som → Avançado → Volume automático → Normal).
- Continuar/resume = biblioteca do Stremio (datastoreGet/Put); progresso salvo a cada 5 s e ao sair, no Stremio
  depois de 45 s. Trailer (YouTube da TV), marcar como visto (Stremio + Trakt), "+" salva na biblioteca.
- Pular abertura = TheIntroDB v4 (`api.theintrodb.org/v4/media?tmdb_id&season&episode`, sem chave).
- Trakt: app PKCE, device flow; o app chama o Trakt pela ponte (`Player.request`) por causa do CORS.
- Scrub: seta pausa, a barra desliza acelerando, carrega 0,8 s depois de soltar; OK confirma, Voltar cancela (o
  controle Samsung manda keyup a cada repetição).
- Séries grandes: temporadas lado a lado se cabem, senão dropdown.

### Curadoria (`client/curation/`)
- `curate.py --letterboxd ~/sofa-tv/survey/letterboxd`: modela o gosto pelas notas/reviews do Letterboxd
  (@ericklpc, export + RSS) e o histórico do Trakt, publica a lista Trakt **"Sofá · Curadoria da semana"** e as
  fileiras pessoais da home ("Porque você deu 5★ em…", "Mais de <diretor>", temas, países).
- Mistura atual (a pedido do Erick, "a primeira foi melhor"): 3 "porque", 3 diretores, 2 temas, 2 países; diretor
  ≥ 6 títulos, demais ≥ 8 (até 15). A política aprendida (`out/policy.json`, `out/metrics.jsonl`, minutos assistidos
  da biblioteca do Stremio) mexe no máximo 1 fileira por rodada e só com dados reais.
- Objetivo dado pelo Erick: maximizar tempo de tela, como engenheiro do algoritmo da Netflix; melhorar semana a semana
  com métricas; não explicar escolhas na UI, só quando for argumento de autoridade.
- Login no Letterboxd: não existe API pra terceiros; usamos o perfil público.

## 6. Jobs agendados

- **launchd no Mac**: `~/Library/LaunchAgents/sofa.curation.plist` → `~/sofa-player/client/curation/weekly.sh`,
  **segunda e quinta às 8h** (aprovado por escrito pelo Erick). Log: `~/Library/Logs/sofa-curation.log`.
  Roda o commit que estiver em `~/sofa-player` (hoje `24def2b`). Pra atualizar: `git fetch && git checkout --detach
  <commit>` lá. Conferir: `launchctl list | grep sofa`.
- Nenhum trigger na nuvem.

## 7. Como gerar e instalar (sempre no Mac)

Launcher:
```bash
cd ~/sofa-tv && git fetch && git checkout <commit do sofa>
./firetv/build.sh                       # → firetv/Sofa-FireTV.apk (guarde firetv/sofa.keystore)
adb connect 192.168.15.22:5555 && adb -s 192.168.15.22:5555 install -r firetv/Sofa-FireTV.apk
python3 tizen/build.py --sign SofaTV    # → Sofa-Launcher-tizen.wgt
~/tizen-studio/tools/sdb connect 192.168.15.21
~/tizen-studio/tools/tizen-core/tz install -p Sofa-Launcher-tizen.wgt -e 192.168.15.21:26101
```
Player:
```bash
cd ~/sofa-player && git fetch && git checkout --detach <commit>
(cd firetv && ./build.sh --proto)       # → firetv/Sofa-Player.apk; precisa da Google Maven (o Mac alcança, a nuvem não)
adb -s 192.168.15.22:5555 install -r firetv/Sofa-Player.apk
python3 client/proto/build.py --tizen --sign SofaTV   # → Sofa-Player-tizen-signed.wgt
~/tizen-studio/tools/tizen-core/tz install -p Sofa-Player-tizen-signed.wgt -e 192.168.15.21:26101
python3 client/proto/build.py --serve   # preview no navegador, porta 8766
```
Preview do launcher: `python3 webos/build.py --preview` e abrir `out/webos/index.html` (o Mac serviu em 127.0.0.1:8765).

Debloat do Fire TV: `~/sofa-debloat/firetv/debloat.sh 192.168.15.22` (dry run), `--apply 2`, `--restore`.

Logs: `adb logcat -s Sofa` (console da página no Fire), `chrome://inspect` com adb. Na Samsung, a conexão de
desenvolvedor só instala/abre: sem print, sem tecla; use `debug_log` + coletor no Mac.

**Limites do ambiente:** a nuvem não alcança strem.io, metahub, TheIntroDB, Google Maven nem as TVs. Tudo que toca
TV ou rede dessas passa pela sessão Remote Control no Mac (pasta `~/portfolio-v2`, mas trabalhe em `~/sofa-*`).
Duas threads usando adb/sdb ao mesmo tempo já derrubaram teste: **avise a outra thread antes de instalar/abrir algo
numa TV**.

## 8. O que está feito

- Launcher Sofá rodando no Fire TV e virando a "home" de fato (vigia do Home + tela de carregamento + abre ao ligar).
- Logos sem distorcer, sem borda, abertura ~2 s mais rápida (`608b344` instalado no Fire).
- Launcher na Frame (`f2d3b1e` instalado; `c907ff8` no branch, ainda não instalado).
- Sofá Player no Fire TV e na Frame (`24def2b`/`cfbc302`): TTFF < 0,2 s, legendas pt-BR, pular abertura, próximo
  episódio, fallback, scrub, normalização (Fire), trailer, visto, "+", progresso, séries grandes, menu flutuante com
  páginas Buscar/Filmes/Séries/Curadoria/Biblioteca.
- Curadoria + home personalizada (10 fileiras), job seg/qui.
- Debloat Fire TV níveis 1 e 2: 16 apps desligados, RAM livre 600 → 781 MB. Nível 3 e animações não aplicados.

## 9. Pendências e bloqueios

1. **Erick conectar o Trakt na TV** (Sofá Player → Ajustes → Trakt) pra testar o scrobble.
2. **Validação de 2 semanas** (até ~04/11): taxa de 1ª escolha, TTFF, aberturas do menu de fontes, notas dos filmes
   curados × média dele, prints lado a lado com o app TV da Apple. As métricas ficam no navegador/`out/metrics.jsonl`.
3. **Frame, botão Home:** Erick escolheu o caminho seguro (Autorun Last App + Sofá 1º na fileira da Samsung), passos
   enviados, **falta ele confirmar que a TV liga no Sofá**. Trocar o Home de verdade (vconf `home_appid` /
   `startup_appid` via exploit, CleanFrame/quiet-tizen/dvnkshl) foi descartado: amarrado a firmware, risco de
   quebrar o boot. Botões de marca (Netflix etc.) do controle Samsung não remapeiam.
4. **Frame, testes pendentes:** TV ao vivo abre? OK num card abre o título no Sofá Player? HBO Max abre? Instalar
   `c907ff8` (corrige o HBO pegando o `aov-dashboard`).
5. **Debloat da Frame:** lista lida (24 apps, todos removíveis). Sugestão enviada: tirar Samsung Promotion, Bixby,
   Mercado Play, Vivo TV, Copilot, Alexa, Boosteroid, GeForce NOW, Xbox. **Esperando o OK dele** com a lista.
   Remover com `sdb shell 0 vd_appuninstall <id>`. Nunca remover SofaPlayer/SofaLaunch, SmartThings (Art Mode).
6. **Samsung do quarto:** falta o IP e qual app estava aberto quando o descanso de tela entrou (o player Tizen já
   desliga o screensaver tocando, no commit 6b10bc3; pode ser outro app ou a TV sem o Sofá).
7. **PR #1** (player → `sofa`) aberto e mergeable; o `sofa` andou 6 commits desde a base. Decidir merge com o Erick.
8. Fire TV: `Home on Fire` ainda instalado e inútil (com `enabled_accessibility_services` e
   `accessibility_enabled=1` setados); oferecido desinstalar, sem resposta.
9. Dicas que o Erick ainda pode fazer no controle: Fire TV → Preferências → Conteúdo em destaque (desligar autoplay
   de vídeo/áudio); Frame → desligar Autorun TV Plus/Smart Hub, Viewing Information, anúncios por interesse.

## 10. Regras que não podem quebrar

- Nunca commitar/mostrar `config.properties`, `*.keystore`, token do Trakt, URL do manifest do AIOStreams (ela carrega
  a config) nem a chave do Stremio.
- Debloat só com `pm disable-user --user 0` (ou `uninstall -k --user 0`), com log e `--restore`. Nunca mexer na home
  da Amazon (`com.amazon.tv.launcher`), Ajustes, Appstore (`com.amazon.venezia`, sem ela Netflix/Max/Globoplay perdem
  licença), Prime Video, teclado, WebView, `io.sofa.*` ou app que salvou Wi-Fi.
- Não mudar configurações de imagem, som, rede ou conta das TVs pelo adb/sdb; isso é com o Erick.
- Assinatura: o launcher Fire usa `firetv/sofa.keystore`; Samsung usa o perfil `SofaTV`. Trocar quebra atualização.
