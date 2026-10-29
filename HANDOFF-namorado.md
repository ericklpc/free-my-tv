# Instalar o Sofá numa TV nova (handoff pro Claude de quem vai instalar)

Escrito em 28/10/2026 pelo Claude do projeto do Erick. Você é o Claude do namorado do Erick, numa outra casa, e vai
instalar dois apps na TV dele:

1. **Sofá**: uma home no estilo do app TV da Apple, com o conteúdo do Stremio (Continuar, Filmes, Séries) e atalhos
   pros apps de streaming.
2. **Sofá Player**: um player do Stremio no estilo tvOS, que toca pelo TorBox (via AIOStreams), com legenda pt-BR,
   pular abertura e próximo episódio.

Ele vai usar **a conta do Stremio e o TorBox do Erick**. Nenhuma chave está neste documento nem no GitHub.

## 0. Regras

- **Segredos não passam pelo chat.** O `config.properties` (chave do Stremio, link do AIOStreams que carrega o TorBox,
  chave do TMDB, Trakt) e os arquivos gerados com ele (`.apk`, `.wgt`) são do Erick. Ele manda direto pro namorado
  por um canal privado (AirDrop, Signal/WhatsApp como arquivo, ou um "Send" do 1Password/Bitwarden). Você só lê
  o arquivo do disco: nunca imprima o conteúdo, nunca commite, nunca cole no chat.
- Diga o que vai fazer na TV antes de fazer. Quem aceita permissões na TV é ele, no controle.
- Não mude imagem, som, rede ou conta da TV. Não desinstale app de sistema.
- O repositório é `github.com/ericklpc/free-my-tv`. O `CLAUDE.md` na raiz explica a base (free-my-tv); leia antes.

## 1. Primeiro, descubra a TV

Pergunte a marca e o modelo, ou peça uma foto de *Configurações → Sobre*.

| TV / aparelho | Caminho |
|---|---|
| Fire TV Stick com **Fire OS** (4K 1ª/2ª ger., 4K Max, Lite, Cube) | Seção 3. Mais fácil: o Erick manda os APKs prontos. |
| Fire TV Stick **HD ou 4K Select de 2025/26 (Vega OS)** | Não instala app de fora. Sugira um Fire TV Stick 4K Max ou um Google TV Streamer. |
| Google TV / Android TV (TCL, Sony, Philips, Chromecast com Google TV...) | Seção 3 também (o APK é Android comum). |
| Samsung (2017+, Tizen) | Seção 4. Precisa de certificado Samsung feito pra essa TV. |
| LG (webOS) | Não testado com o Sofá Player. Só o launcher funciona (`webos/`, ver `CLAUDE.md`). Fale com o Erick antes. |

Ele também precisa do IP da TV (Configurações → Rede) e de um computador na mesma rede (Mac, Linux ou Windows com WSL).

## 2. O que ele recebe do Erick (em privado)

- **Fire TV / Android:** `Sofa-FireTV.apk` e `Sofa-Player.apk` já prontos, com as chaves dentro. Não precisa
  compilar nada.
- **Samsung:** o `config.properties` do Erick. Você compila aqui, porque a assinatura tem que ser desta TV.

Se ele morar em outra cidade, troque no `config.properties` dele `latitude`, `longitude` e `city` (é o clima e o
anoitecer da home). Apague a linha `debug_log=` se existir: ela manda logs pro Mac do Erick.

## 3. Fire TV / Android TV

Ferramenta: só o `adb` (macOS: `brew install --cask android-platform-tools`; Linux: pacote `adb`).

Na TV (ele faz): *Configurações → Minha Fire TV → Sobre* → clicar 7 vezes no nome do aparelho (liga as opções de
desenvolvedor) → *Opções do desenvolvedor* → **Depuração ADB** ligada e **Apps de origem desconhecida** ligado.
Em Google TV: *Configurações → Sistema → Sobre → Build* 7 vezes → *Opções do desenvolvedor → Depuração USB*.

```bash
adb connect <IP>:5555          # a TV pergunta "Permitir depuração?": ele aceita e marca "Sempre permitir"
adb -s <IP>:5555 install -r Sofa-Player.apk
adb -s <IP>:5555 install -r Sofa-FireTV.apk
# Só no Fire TV: deixa o Sofá perceber o botão Home e cobrir a home da Amazon enquanto abre.
adb -s <IP>:5555 shell appops set io.sofa.firetv GET_USAGE_STATS allow
adb -s <IP>:5555 shell appops set io.sofa.firetv SYSTEM_ALERT_WINDOW allow
adb -s <IP>:5555 shell monkey -p io.sofa.firetv -c android.intent.category.LAUNCHER 1
```

Avise antes: o Fire OS não deixa trocar a home de verdade. O Sofá fica de olho e, quando a home da Amazon aparece
(botão Home ou ao ligar a TV), abre por cima em ~1 s. A home da Amazon continua lá, intacta.

Confira: `adb -s <IP>:5555 logcat -s Sofa` mostra a página carregando. Na home, a fileira *Continuar* deve mostrar a
biblioteca do Stremio do Erick; OK num título abre o Sofá Player, que deve tocar em poucos segundos.

**Se precisar compilar você mesmo** (o Erick mandou o `config.properties` em vez dos APKs): JDK 17+, Android SDK
(build-tools 34, platform android-34), Python 3. Launcher: branch `sofa`, `./firetv/build.sh`. Player: branch
`claude/project-thread-bgyc8l`, `cd firetv && ./build.sh --proto` (baixa o Media3 da Google Maven). Coloque o
`config.properties` na raiz de cada clone. Uma TV que já tem o APK do Erick só aceita atualização assinada com a
mesma chave (`firetv/sofa.keystore`): se for atualizar depois, peça ao Erick os APKs novos ou o keystore dele.

## 4. Samsung (Tizen)

1. Na TV (ele faz): *Apps* → digitar `1 2 3 4 5` no controle → *Developer mode* ligado, *Host PC IP* = IP do
   computador → reiniciar a TV.
2. Ferramentas: Tizen Studio CLI (`tizen`/`tz` e `sdb`) ou o plugin `tizen-sdk-skills`
   (github.com/Samsung/tizen-agent-skills). No Mac Apple Silicon o `sdb` precisa do Rosetta: pergunte antes.
3. Certificado (uma vez): TVs 2023+ precisam de certificado Samsung feito com uma conta Samsung **pra esta TV** (o
   DUID dela). Pode ser a conta dele. As senhas do certificado são dele: ele digita no terminal dele. TVs 2017-22
   aceitam um certificado Tizen comum. Chame o perfil de `SofaTV`.
4. Clone o repo duas vezes (`sofa` e `claude/project-thread-bgyc8l`) e ponha o `config.properties` na raiz de cada um.
5. Compile e assine:
   ```bash
   python3 tizen/build.py --sign SofaTV                    # no clone sofa → Sofa-Launcher-tizen.wgt
   python3 client/proto/build.py --tizen --sign SofaTV     # no clone do player → Sofa-Player-tizen-signed.wgt
   ```
   Não renomeie `Sofa-Player-tizen-signed.wgt`: o Tizen tira o id do app do nome do arquivo.
6. Instale: `sdb connect <IP>`, `sdb devices` (pega o serial, tipo `<IP>:26101`), depois
   `tizen install -n <arquivo>.wgt -t <serial>` pros dois (ou `tz install -p <arquivo>.wgt -e <serial>`).
7. Diga a ele: na Samsung o botão Home não troca. Pra TV ligar no Sofá: *Autorun Last App* ligado (Configurações →
   Geral → Recursos do Smart → onde fica muda por ano) e o Sofá em 1º na fileira de apps. O volume automático é o da
   TV (Som → Avançado → Volume automático).

## 5. Conta compartilhada: o que avisar

- **Continuar assistindo é um só.** O que ele assiste aparece no Continuar do Erick e vice-versa, e o progresso de
  um mesmo título é sobrescrito por quem assistiu por último.
- **Trakt:** não conecte o Trakt do Erick nessa TV (Sofá Player → Ajustes → Trakt), senão o histórico e a curadoria
  semanal do Erick misturam os dois. Se ele quiser Trakt, que use uma conta própria. A fileira "Curadoria" é feita
  pro gosto do Erick.
- **TorBox:** é o plano do Erick. Duas casas assistindo ao mesmo tempo contam como duas conexões; vale o Erick
  confirmar o limite do plano dele.
- Mudar os addons no Stremio de um muda pro outro (é a mesma conta).

## 6. Quando terminar

Mande pro Erick (pelo namorado) o que ficou instalado, a TV e o modelo, e qualquer erro. Se algo não funcionar, o
caminho de volta é simples: desinstalar `io.sofa.firetv` e `io.sofa.player` (Android) ou `SofaLaunch.Sofa` e
`SofaPlayer.Sofa` (Samsung). Nada do sistema da TV foi mudado.
