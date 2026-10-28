# Sofá Player

Um cliente estilo Apple TV para o conteúdo do Stremio, no Fire TV / Android TV e na Samsung (Tizen): home com destaque e
fileiras, página do título, player com avanço livre, fontes do seu AIOStreams com pré-carregamento e troca automática,
legendas em pt-BR, pular abertura, próximo episódio, progresso no Stremio e no Trakt, trailers dentro do app e uma
curadoria semanal a partir do seu Letterboxd.

- **Como montar o seu:** [client/README.md](client/README.md)
- **Ou deixe o Claude Code fazer:** cole o [client/PROMPT.md](client/PROMPT.md)

Cada pessoa usa as próprias contas (Stremio, debrid/AIOStreams, TMDB, Trakt). As chaves ficam só no seu
`config.properties`, que nunca vai pro git.

Baseado no [Free My TV](https://github.com/simbasjungles/free-my-tv) (licença MIT, em `LICENSE`); o resto deste
repositório (`app/`, `web/`, `docs/`…) é o Free My TV original.
