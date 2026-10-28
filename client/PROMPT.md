# Prompt: crie o seu Sofá Player

Cole isto no Claude Code (de preferência rodando no seu computador, com acesso à rede de casa e à TV). Troque o que está entre colchetes.

---

Quero que você construa comigo o **Sofá Player**: um app de TV no estilo Apple TV (tvOS) que substitui a interface do Stremio, usando a minha conta e os meus addons. Minhas TVs: [ex.: Fire TV Stick 4K no IP 192.168.x.x / Samsung Tizen no IP 192.168.x.x / Google TV]. Minha cidade: [cidade].

## Regras de segurança (siga sempre)
- Minhas chaves (authKey do Stremio, TMDB, debrid/TorBox, URL de config do AIOStreams, Trakt) ficam só num `config.properties` local, fora do git. Nunca imprima, nunca commite, nunca peça no chat; eu colo no arquivo.
- Avise antes de usar adb/sdb na TV e não instale nada enquanto eu estiver assistindo (confira se há mídia tocando).
- Não mexa nas configurações da TV (imagem, som, rede, conta).
- Nada de contornar proteções de serviços (ex.: extrair links do YouTube se passando pelo app dele). Use só APIs oficiais/públicas.

## Arquitetura
- Interface web (HTML/CSS/JS ES5 puro, sem frameworks; palco fixo de 1920×1080 escalado pra tela), navegada só com as setas, OK, Back, Menu e as teclas de mídia do controle.
- **Fire TV / Android TV:** app Android que mostra a interface num WebView por cima de um player nativo **Media3/ExoPlayer** (com decodificador de áudio ffmpeg para DTS/TrueHD quando a TV não aceita). A página fala com o player por uma ponte `window.Player` (open, preload, play, pause, seekTo, stop, select, state) e recebe eventos (`ready`, `firstFrame`, `buffering`, `error`, `stall`, `ended`, `tracks`, `cues`, `leave`).
- **Samsung (Tizen):** o mesmo web app empacotado como .wgt, com a mesma ponte recriada sobre `webapis.avplay`. Mantenha o nome do arquivo .wgt fixo entre versões (o Tizen tira o id do app dele). Desligue o protetor de tela da Samsung enquanto toca (`webapis.appcommon.setScreenSaver`).
- Antes de começar, meça o que a TV aceita (resolução máxima, HDR10/DV, codecs de vídeo, passthrough de áudio) e use isso pra escolher a fonte.

## Fontes e reprodução
- Streams dos meus addons do Stremio (ex.: AIOStreams com debrid). Ranqueie as fontes pra esta TV: prefira as que já estão em cache no debrid, resolução até o máximo da tela, HDR que a TV suporta, áudio que a TV toca; descarte as que não tocam e diga o motivo.
- **Começar a tocar em menos de 1–3 s:** resolva as fontes quando a página do título abre e **pré-carregue** o vídeo pausado, escondido atrás da página, pra o OK só dar play. Mas o pré-carregamento só acontece depois de ~1 s com o controle parado e nunca no giro automático do destaque (senão a TV trava e as teclas se perdem).
- **Fallback automático:** se a fonte falha ou trava (~6 s sem andar), troca pra próxima na mesma posição, sem eu fazer nada, e avisa num toast.
- Menu de fontes acessível pelo botão "Fontes" e pela tecla Menu.
- Spinner só depois de 600 ms carregando, e some quando a posição andou 3 leituras seguidas (não pode ficar preso na tela).
- Nivelador de volume suave (Media3 AudioProcessor: alvo ~−21 dBFS, no máximo ±8 dB, 1,5 dB/s, limiter em −1 dBFS), pra um filme não ficar mais alto que outro.

## Legendas
- Ordem: pt-BR, depois pt, depois en. Busca externa (OpenSubtitles do Stremio) quando o arquivo não tem; as legendas já vêm junto no pré-carregamento.
- Tamanho e fundo da legenda configuráveis.

## Player (OSD)
- Estilo tvOS: título e "kicker" em cima, barra com tempo decorrido e restante, botões em pílula: **Legendas · Áudio · Fontes · Próximo episódio ▶▶** (este só em séries).
- **Avançar e voltar livremente:** segurar ← → pausa o filme e só a barra anda, acelerando com o tempo (10 s por toque; segurando: 60, 120, 300, até 600 s de filme por segundo). O player só busca uma vez, 0,8 s depois da última tecla, ou na hora com OK. Back cancela. Use só keydown (alguns controles mandam keyup a cada repetição).
- Depois de um seek, mantenha o alvo até o player chegar lá (até 3 s), senão toques seguidos partem da posição antiga.
- A interface some sozinha depois de alguns segundos, incluindo o painel de baixo (Info/Episódios), que fecha após ~6 s parado.
- **Pular abertura** (TheIntroDB, sem chave) e **autoplay do próximo episódio** com contagem.

## Progresso, Stremio e Trakt
- Salve a posição localmente a cada 5 s e ao sair (visibilitychange, pagehide e o evento nativo `leave`), e no Stremio (datastore da biblioteca) depois de 45 s assistidos. Voltar pro título retoma de onde parou.
- "Continuar assistindo" vem da biblioteca do Stremio.
- Botão **+** adiciona/remove da biblioteca do Stremio (e da watchlist do Trakt, se logado). Botão **✓** marca como visto no Stremio e no Trakt.
- Trakt: login por código (trakt.tv/activate no celular) e scrobble start/pause/stop. Se o Trakt recusar CORS no app local, faça as chamadas pela ponte nativa.

## Interface (home e página do título)
- Home estilo Apple TV: destaque grande no topo com rotação a cada ~9 s e **dots com a bolinha ativa animada** marcando o tempo; fileiras de cards abaixo com espaçamento generoso entre seções; títulos das fileiras alinhados igual em todas.
- Nunca mostre fileiras com poucos itens (mínimo 8); esconda as que não chegam lá.
- Cards de recomendação: sinopse curta (2 linhas) + duração; cite diretor, ator ou gênero só quando for um argumento forte (ex.: diretor de um filme que dei 5★).
- Página do título: arte de fundo, logo em pt-BR do TMDB, meta, sinopse, e os botões **Assistir/Continuar (com barra de progresso) · Trailer · + · ✓ · Fontes**; abaixo, elenco/direção e relacionados.
- Séries: temporadas em abas lado a lado quando cabem; quando são muitas, um dropdown que abre uma lista. Episódios com still, título e progresso. Se o TMDB não tiver, use o Cinemeta.

## Trailers (dentro do app, com a interface do Sofá)
- Faça como o Stremio: pegue o trailer do **Cinemeta** (`trailerStreams[].ytId`) primeiro e use os vídeos do TMDB (YouTube, ordenados por Trailer > Teaser, pt, oficial, 1080p, mais novo) como reserva.
- Toque com a **YouTube IFrame Player API oficial** (`controls:0, disablekb:1, fs:0, rel:0, iv_load_policy:3, modestbranding:1, playsinline:1`), em 100% da tela, por baixo do OSD do Sofá. Uma ponte JS faz esse player se passar pelo `window.Player` enquanto o trailer toca (play, pause, seek, tempo), e devolve o player real no Stop.
- **Erro 153** (o YouTube recusa embed em página local `file://`): hospede uma página `yt.html` minúscula em https (ex.: GitHub Pages do seu fork) que carrega a IFrame API e conversa com o app por `postMessage`; o app abre essa página num iframe.
- **Erro 150** (o dono não deixa tocar fora do YouTube): tente o próximo vídeo da lista antes de avisar.
- Esconda a camada do YouTube até ela estar tocando (~0,4–0,9 s depois do play) e na pausa (mostre a arte do título com o OSD). Retomar da pausa recarrega o vídeo no ponto onde parou, pra não sobrar o ícone de pausa nem a legenda do YouTube.
- Legendas do YouTube desligadas por padrão; o botão Legendas do Sofá liga pt/en.
- Busque os vídeos do trailer quando a página do título abre; se eu apertar Trailer antes de chegarem, o botão mostra "Carregando…" e abre assim que chegar.
- Nada salva progresso nem faz scrobble no trailer.

## Curadoria "Escolhidos pra você"
- Um script (Python) que roda 2× por semana no computador: lê meu Letterboxd (RSS público de [@meu_usuario]) e o Trakt, monta fileiras pessoais ("porque você viu X", diretor, tema, país), cada uma com 8–15 títulos, sem repetir títulos nem fileiras entre os "decks".
- Mede o tempo que eu realmente assisti (biblioteca do Stremio) contra o que foi mostrado, e ajusta a mistura de fileiras aos poucos (no máximo uma fileira por rodada, só com dados suficientes). Comece com 3 "porque" / 3 diretor / 2 tema / 2 país.
- No fim da home, um botão "Nova curadoria pra você" troca pro próximo deck.

## O que NÃO funcionou (não repita)
- Instâncias públicas de Invidious/Piped: quase todas fora do ar ou com login (uma pedia usuário e senha).
- Empurrar a interface do YouTube pra fora com um iframe 3× mais alto: corta trailers widescreen.
- Mudar o user-agent do WebView tirando "wv/Mobile": o YouTube baixou pra 240p.
- Pré-carregar a cada foco/giro do destaque: trava a TV.
- Disparar dezenas de pedidos ao TMDB de uma vez: erro 429. Use fila (6 por vez) e tente de novo no 429.

## Como trabalhar
Comece medindo a TV e montando a home com dados reais; depois o player e o pré-carregamento; depois legendas, progresso/Trakt, trailers e curadoria. Teste cada etapa na TV uma vez (com o meu OK), me mostre um print e me diga o que mudou em uma ou duas frases.
