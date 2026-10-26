#!/usr/bin/env python3
"""Erick's weekly picks: films he hasn't seen, close to his taste, already cached in his debrid.

    python3 client/curation/curate.py --letterboxd ~/sofa-tv/survey/letterboxd        # this week's picks
    python3 client/curation/curate.py --letterboxd ... --backtest                     # how well the model guesses
    python3 client/curation/curate.py --trakt-login                                   # once: lets it write the Trakt list

Taste: every film he rated becomes TMDB features (genres, keywords, director, writers, main cast, country, language,
decade), weighted by how far his rating is from his average, liked films a little more. Candidates: TMDB's
recommendations for what he rated highest, his watchlist, this year's releases and the classics. Each candidate
scores by how much of his taste it shares, plus its standing with critics and audiences. Then only what AIOStreams
finds cached in TorBox, playable on the Fire TV (same rules as ranking.js), makes the list: ten new releases, ten
classics and ten in between, each with a line on why.

Writes client/curation/out/picks.json (the Sofá Player's "Pra você" row reads it at build time) and, after
--trakt-login, the Trakt list "Sofá · Curadoria da semana". Needs tmdb_key and aiostreams_url in config.properties.
Python 3 standard library only. Keeps TMDB answers in client/curation/out/cache/ for a week.
"""
import argparse
import csv
import datetime
import hashlib
import json
import math
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, 'out')
CACHE = os.path.join(OUT, 'cache')
TRAKT_TOKEN = os.path.expanduser('~/.sofa-trakt.json')
TMDB = 'https://api.themoviedb.org/3'
THIS_YEAR = datetime.date.today().year
GENRES_PT = {}


def config():
    values = {}
    path = os.path.join(ROOT, 'config.properties')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                values[k.strip()] = v.strip().strip('"')
    return values


CFG = config()


def http(url, data=None, headers=None, timeout=40):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers=dict({'User-Agent': 'sofa-curation', 'Content-Type': 'application/json'}, **(headers or {})))
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + attempt * 2)
                continue
            try:
                return e.code, json.loads(e.read() or b'null')
            except ValueError:
                return e.code, None
        except Exception:
            time.sleep(1 + attempt)
    return 0, None


def tmdb(path, **params):
    """A TMDB answer, from the week's cache when there is one."""
    params['api_key'] = CFG.get('tmdb_key', '')
    url = TMDB + path + '?' + urllib.parse.urlencode(params)
    key = hashlib.sha1((path + json.dumps(sorted((k, str(v)) for k, v in params.items() if k != 'api_key'))).encode()).hexdigest()
    file = os.path.join(CACHE, key[:2], key + '.json')
    if os.path.exists(file) and time.time() - os.path.getmtime(file) < 7 * 86400:
        with open(file, encoding='utf-8') as f:
            return json.load(f)
    status, o = http(url)
    if status != 200:
        return None
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, 'w', encoding='utf-8') as f:
        json.dump(o, f)
    return o


def parallel(fn, items, workers=12):
    with ThreadPoolExecutor(workers) as pool:
        return list(pool.map(fn, items))


# MARK: - His films

def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        lines = f.read().splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith('Date,') or l.startswith('Position,')), 0)
    return list(csv.DictReader(lines[start:]))


def find_tmdb(row):
    """A Letterboxd row (name, year) → its TMDB id."""
    name, year = row['Name'], row.get('Year') or ''
    for y in ([year] if year else []) + ['']:
        o = tmdb('/search/movie', query=name, year=y) if y else tmdb('/search/movie', query=name)
        res = (o or {}).get('results') or []
        if res:
            if year:
                same = [r for r in res if (r.get('release_date') or '')[:4] == year]
                if same:
                    return same[0]['id']
            return res[0]['id']
    return None


def details(tid):
    return tmdb('/movie/%d' % tid, append_to_response='keywords,credits,recommendations,similar,external_ids',
                language='pt-BR')


# Keywords that half of cinema has: they'd make every pick look alike ("based on a book, like Call Me by Your Name").
GENERIC = {'based on novel or book', 'based on true story', 'woman director', 'duringcreditsstinger', 'aftercreditsstinger',
           'sequel', 'remake', 'biography', 'friendship', 'love', 'family', 'murder', 'death', 'new york city', 'los angeles, california',
           'london, england', 'paris, france', 'based on comic', 'based on play or musical', 'based on short story', 'dramatic',
           'betrayal', 'revenge', 'loss', 'relationship', 'small town', 'husband wife relationship', 'father son relationship',
           'mother daughter relationship', 'mother son relationship', 'father daughter relationship', 'rivalry', 'suspenseful', 'intense',
           'romantic', 'inspirational', 'admiring', 'hopeful', 'melancholy', 'sad', 'cautionary', 'anxious', 'bold', 'complex'}
GENERIC_RE = re.compile(r'^\d{4}s$|^\d{2}th century$')
# How much each kind of feature says about taste: an auteur's name says more than a genre or a decade.
KIND_W = {'d': 2.2, 'w': 1.4, 'p': 1.0, 'c': 0.7, 'k': 1.0, 'g': 0.35, 'o': 0.8, 'l': 0.8, 'y': 0.25}


def features(d):
    f = []
    f += ['g:%d' % g['id'] for g in d.get('genres', [])]
    f += ['k:%d' % k['id'] for k in (d.get('keywords') or {}).get('keywords', [])[:25]
          if k['name'].lower() not in GENERIC and not GENERIC_RE.match(k['name'].lower())]
    crew = (d.get('credits') or {}).get('crew', [])
    f += ['d:%d' % c['id'] for c in crew if c.get('job') == 'Director']
    f += ['w:%d' % c['id'] for c in crew if c.get('department') == 'Writing'][:3]
    f += ['p:%d' % c['id'] for c in crew if c.get('job') == 'Director of Photography'][:1]
    f += ['c:%d' % c['id'] for c in (d.get('credits') or {}).get('cast', [])[:4]]
    # Where it's from, not who co-produced it (Call Me by Your Name is Italian, though France and Brazil put money in).
    f += ['o:' + c for c in (d.get('origin_country') or [c['iso_3166_1'] for c in d.get('production_countries', [])[:1]])[:1]]
    if d.get('original_language'):
        f.append('l:' + d['original_language'])
    y = (d.get('release_date') or '0000')[:4]
    if y.isdigit():
        f.append('y:%d0s' % (int(y) // 10))
    return f


def names(d):
    """Feature → readable name, for the why lines."""
    n = {}
    for g in d.get('genres', []):
        n['g:%d' % g['id']] = g['name']
    for k in (d.get('keywords') or {}).get('keywords', []):
        n['k:%d' % k['id']] = k['name']
    for c in (d.get('credits') or {}).get('crew', []):
        n['d:%d' % c['id']] = n['w:%d' % c['id']] = n['p:%d' % c['id']] = c['name']
    for c in (d.get('credits') or {}).get('cast', [])[:4]:
        n['c:%d' % c['id']] = c['name']
    return n


def load_history(folder):
    ratings = read_csv(os.path.join(folder, 'ratings.csv'))
    watched = read_csv(os.path.join(folder, 'watched.csv'))
    watchlist = read_csv(os.path.join(folder, 'watchlist.csv'))
    likes = read_csv(os.path.join(folder, 'likes', 'films.csv'))
    rows = {}
    for r in watched + ratings + watchlist + likes:
        rows[(r['Name'], r.get('Year'))] = r
    ids = dict(zip(rows.keys(), parallel(find_tmdb, list(rows.values()))))
    def tid(r):
        return ids.get((r['Name'], r.get('Year')))
    rated = [(tid(r), float(r['Rating']), r['Name'], r.get('Year')) for r in ratings if r.get('Rating') and tid(r)]
    liked = set(tid(r) for r in likes if tid(r))
    seen = set(tid(r) for r in watched + ratings if tid(r))
    wish = set(tid(r) for r in watchlist if tid(r)) - seen
    missing = [r['Name'] for r in ratings if not tid(r)]
    if missing:
        print('curation: no TMDB match for %d rated films: %s' % (len(missing), ', '.join(missing[:8])), file=sys.stderr)
    # What he logged after the export: his public diary feed, so every run is current without a new export.
    profile_csv = read_csv(os.path.join(folder, 'profile.csv'))
    user = os.environ.get('LETTERBOXD_USER') or (profile_csv[0].get('Username') if profile_csv else '')
    if user:
        have = dict((t, i) for i, (t, _, _, _) in enumerate(rated))
        new = 0
        for t, rating, name, year in letterboxd_feed(user):
            seen.add(t); wish.discard(t)
            if rating is None:
                continue
            if t in have:
                rated[have[t]] = (t, rating, name, year)
            else:
                have[t] = len(rated); rated.append((t, rating, name, year)); new += 1
        print('curation: Letterboxd @%s: %d new ratings since the export' % (user, new))
    return rated, liked, seen, wish


def letterboxd_feed(user):
    """The last ~50 diary entries from letterboxd.com/<user>/rss/: (tmdb id, rating or None, title, year)."""
    import urllib.request, xml.etree.ElementTree as ET
    try:
        req = urllib.request.Request('https://letterboxd.com/%s/rss/' % user, headers={'User-Agent': 'Mozilla/5.0 (Sofa curation)'})
        root = ET.fromstring(urllib.request.urlopen(req, timeout=20).read())
    except Exception as e:
        print('curation: Letterboxd feed failed: %s' % e, file=sys.stderr)
        return []
    ns = {'l': 'https://letterboxd.com', 't': 'https://themoviedb.org'}
    out = []
    for item in root.iter('item'):
        tid = item.findtext('t:movieId', namespaces=ns)
        if not tid:
            continue
        r = item.findtext('l:memberRating', namespaces=ns)
        out.append((int(tid), float(r) if r else None, item.findtext('l:filmTitle', namespaces=ns), item.findtext('l:filmYear', namespaces=ns)))
    return out


# MARK: - Taste and candidates

def profile(rated, liked, info):
    mean = sum(r for _, r, _, _ in rated) / len(rated)
    weight, count, best = {}, {}, {}
    for tid, rating, name, year in rated:
        d = info.get(tid)
        if not d:
            continue
        w = (rating - mean) + (0.5 if tid in liked else 0)
        for f in set(features(d)):
            weight[f] = weight.get(f, 0) + w
            count[f] = count.get(f, 0) + 1
            if rating >= 4 and (f not in best or rating > best[f][1]):
                best[f] = (name, rating)
    taste = {f: KIND_W.get(f[0], 1) * weight[f] / math.sqrt(count[f] + 1) for f in weight}
    return taste, best, mean


def rarity(docs):
    """Inverse document frequency over the candidates: a feature every candidate has explains nothing."""
    df = {}
    for d in docs:
        for f in set(features(d)):
            df[f] = df.get(f, 0) + 1
    n = float(len(docs) or 1)
    return {f: math.log(1 + n / c) for f, c in df.items()}


def score(d, taste, wish, idf=None):
    f = set(features(d))
    sim = sum(taste.get(x, 0) * (idf.get(x, 1) if idf else 1) for x in f) / math.sqrt(len(f) + 4) / (2.5 if idf else 1)
    votes = d.get('vote_count') or 0
    quality = ((d.get('vote_average') or 6) - 6.6) * min(1.0, math.log10(votes + 1) / 3)
    return sim + 0.35 * quality + (0.4 if d['id'] in wish else 0)


def candidate_ids(rated, info, wish, seed_min=4.0):
    ids = set(wish)
    for tid, rating, _, _ in rated:
        d = info.get(tid)
        if rating >= seed_min and d:
            for key in ('recommendations', 'similar'):
                ids.update(m['id'] for m in (d.get(key) or {}).get('results', [])[:20])
    since = (datetime.date.today() - datetime.timedelta(days=540)).isoformat()
    for page in (1, 2, 3, 4):
        o = tmdb('/discover/movie', **{'primary_release_date.gte': since, 'sort_by': 'popularity.desc', 'vote_count.gte': 40, 'page': page})
        ids.update(m['id'] for m in (o or {}).get('results', []))
    for page in range(1, 16):
        o = tmdb('/movie/top_rated', page=page)
        ids.update(m['id'] for m in (o or {}).get('results', []))
    return ids


# MARK: - Cached and playable (ranking.js's rules for this TV)

def playable(st):
    text = '%s\n%s\n%s' % (st.get('name', ''), st.get('description', ''), (st.get('behaviorHints') or {}).get('filename', ''))
    if not st.get('url'):
        return False
    if not ('⚡' in text or re.search(r'\+\]|cached', st.get('name', ''), re.I)):
        return False
    if re.search(r'AV1', text, re.I):
        return False
    if re.search(r'\bDV\b|Dolby ?Vision|DoVi', text, re.I) and not re.search(r'HDR10|\bHDR\b', text, re.I):
        return False
    m = re.search(r'([\d.,]+)\s*Mbps', text, re.I)
    return not (m and float(m.group(1).replace(',', '.')) > 30)


CACHED = {}


def cached(imdb):
    if imdb in CACHED:
        return CACHED[imdb]
    CACHED[imdb] = ok = cached_now(imdb)
    return ok


def cached_now(imdb):
    base = re.sub(r'/(manifest\.json|configure)$', '', CFG.get('aiostreams_url', '').strip().rstrip('/'))
    if not base or not imdb:
        return False
    status, o = http('%s/stream/movie/%s.json' % (base, imdb), timeout=60)
    return status == 200 and any(playable(s) for s in (o or {}).get('streams', []))


# MARK: - Why lines

KW_PT = {'coming of age': 'amadurecimento', 'gay theme': 'romance gay', 'lgbt': 'cinema queer', 'gay': 'cinema queer',
         'queer': 'cinema queer', 'lesbian': 'romance lésbico', 'transgender': 'protagonista trans', 'dark comedy': 'humor ácido',
         'satire': 'sátira', 'psychological thriller': 'suspense psicológico', 'neo-noir': 'neo-noir', 'serial killer': 'serial killer',
         'dystopia': 'distopia', 'folk horror': 'folk horror', 'witch': 'bruxaria', 'cult': 'seita', 'body horror': 'body horror',
         'surrealism': 'surrealismo', 'class differences': 'luta de classes', 'social commentary': 'crítica social',
         'artificial intelligence (a.i.)': 'inteligência artificial', 'loneliness': 'solidão', 'first love': 'primeiro amor',
         'dictatorship': 'ditadura', 'military dictatorship': 'ditadura militar', 'favela': 'favela', 'sertão': 'sertão',
         'teenage girl': 'adolescência', 'high school': 'colégio', 'drug addiction': 'vício', 'grief': 'luto',
         'mental illness': 'saúde mental', 'existentialism': 'existencialismo', 'slow cinema': 'cinema contemplativo',
         'nonlinear timeline': 'narrativa fora de ordem', 'unreliable narrator': 'narrador não confiável', 'heist': 'roubo',
         'anime': 'anime', 'stop motion': 'stop motion', 'musical': 'musical', 'period drama': 'drama de época',
         'female protagonist': 'protagonista mulher', 'mother daughter relationship': 'mãe e filha', 'religion': 'fé',
         'slasher': 'slasher', 'haunted house': 'casa assombrada', 'demonic possession': 'possessão', 'space': 'espaço',
         'time travel': 'viagem no tempo', 'police brutality': 'violência policial', 'gangster': 'gângsteres', 'mafia': 'máfia',
         'fashion': 'moda', 'ballet': 'balé', 'drugs': 'drogas', 'rave': 'rave', 'vampire': 'vampiros', 'creature': 'criatura'}
COUNTRY_PT = {'BR': 'brasileiro', 'FR': 'francês', 'KR': 'coreano', 'JP': 'japonês', 'IT': 'italiano', 'IR': 'iraniano',
              'MX': 'mexicano', 'AR': 'argentino', 'DK': 'dinamarquês', 'NO': 'norueguês', 'ES': 'espanhol', 'DE': 'alemão',
              'CN': 'chinês', 'HK': 'de Hong Kong', 'TW': 'taiwanês', 'CA': 'canadense', 'SE': 'sueco', 'PL': 'polonês',
              'BE': 'belga', 'CL': 'chileno', 'CO': 'colombiano', 'PT': 'português', 'TH': 'tailandês', 'IN': 'indiano', 'RU': 'russo'}


def stars(r):
    return ('%g' % r).replace('.', ',') + '★'


def reasons(d, taste, best, idf):
    f = set(features(d))
    return sorted(((taste.get(x, 0) * idf.get(x, 1), x) for x in f if taste.get(x, 0) > 0 and x in best), reverse=True)


def why(d, taste, best, idf, said=None, skip=None, bare=True):
    """One line, in Portuguese: who made it, or what it shares with films he rated high, and the critics' grade."""
    n = names(d)
    kw = dict(((('k:%d' % k['id']), k['name'].lower()) for k in (d.get('keywords') or {}).get('keywords', [])))
    out, used, themes = [], set(), []
    for _, f in reasons(d, taste, best, idf):
        # A row's own reason, already in its title: Kubrick as writer too, in "Mais de Stanley Kubrick".
        if skip and (f == skip or (f[0] in 'dwpc' and skip[0] in 'dwpc' and f[2:] == skip[2:])):
            continue
        film, rating = best[f]
        k, line = f[0], ''
        if k in 'dwpc' and not re.search('[A-Za-z]', n.get(f, '')):     # 홍경표: TMDB has no Latin name here
            continue
        if k == 'd':
            line = 'De %s, que fez %s (%s)' % (n.get(f, '?'), film, stars(rating))
        elif k == 'w':
            line = 'Roteiro de %s, de %s (%s)' % (n.get(f, '?'), film, stars(rating))
        elif k == 'p':
            line = 'Fotografia de %s, a de %s (%s)' % (n.get(f, '?'), film, stars(rating))
        elif k == 'c':
            line = 'Com %s, de %s (%s)' % (n.get(f, '?'), film, stars(rating))
        elif k == 'k' and kw.get(f) in KW_PT:
            label = KW_PT[kw[f]]
            if any(label in t or t in label for t in themes):    # "ditadura" after "ditadura militar"
                continue
            themes.append(label)
            line = '%s, como em %s (%s)' % (label.capitalize(), film, stars(rating))
        elif k == 'o' and f[2:] in COUNTRY_PT and f[2:] != 'US':
            line = 'Cinema %s, como %s (%s)' % (COUNTRY_PT[f[2:]], film, stars(rating))
        # A reason already given for two other picks stops telling him anything.
        if not line or film in used or (said is not None and said.get(f, 0) >= 2):
            continue
        out.append(line)
        used.add(film)
        if said is not None:
            said[f] = said.get(f, 0) + 1
        if len(out) == 2:
            break
    if not out and not bare:
        return ''                                           # inside a row of its own, a genre alone says nothing
    if not out:
        g = [x['name'].lower() for x in d.get('genres', [])][:2]
        out.append(' e '.join(g).capitalize() if g else 'Fora da sua zona de conforto')
    crit, votes = d.get('vote_average') or 0, d.get('vote_count') or 0
    if crit >= 7.6 and votes > 400:
        out.append('nota %s no TMDB' % ('%.1f' % crit).replace('.', ','))
    return ' · '.join(out)


def main_reason(d, taste, best, idf):
    r = reasons(d, taste, best, idf)
    return r[0][1] if r else None


# MARK: - Metrics: of what the home showed, what he watched (and for how long), and what the next run learns from it
#
# The goal is his time in front of the TV, so the number that counts is minutes watched. Each run:
#  - reads Stremio's library (the app saves the position and the time watched there, like Stremio does) and compares
#    it with the last run's copy: the minutes since then, per title;
#  - credits them to what the last run put on the home (the picks by group, the rows by kind) and writes a line to
#    out/metrics.jsonl: shown, started (10 min or more), finished, minutes, and the minutes of everything he watched;
#  - learns: each kind of row keeps its minutes per title shown (older runs count less), and the next run gives more
#    rows to the kinds that hold him, with some room to try the others (Thompson sampling).

HISTORY = os.path.join(OUT, 'history')
METRICS = os.path.join(OUT, 'metrics.jsonl')
POLICY = os.path.join(OUT, 'policy.json')
KINDS = ('because', 'director', 'theme', 'country')
ROWS_TOTAL = 10


def library():
    """Stremio's library: {imdb id: (ms watched in all, times finished)}."""
    key = CFG.get('stremio_auth_key', '').strip()
    if not key:
        return None
    st, o = http('https://api.strem.io/api/datastoreGet', {'authKey': key, 'collection': 'libraryItem', 'all': True})
    items = (o or {}).get('result') if st == 200 else None
    if items is None:
        print('curation: Stremio library unavailable (%s)' % st, file=sys.stderr)
        return None
    out = {}
    for it in items:
        s = it.get('state') or {}
        out[it.get('_id')] = (int(s.get('overallTimeWatched') or 0), int(s.get('timesWatched') or 0) + int(s.get('flaggedWatched') or 0))
    return out


def shown(out):
    """What this run puts on the home, and the library as it is now: next run's starting point."""
    os.makedirs(HISTORY, exist_ok=True)
    slots = [{'id': p['id'], 'slot': 'pick:' + p['group'], 'pos': i} for i, p in enumerate(out['picks'])]
    for r in out['rows']:
        slots += [{'id': x['id'], 'slot': 'row:' + r['kind'], 'row': r['title'], 'pos': i} for i, x in enumerate(r['items'])]
    lib = library()
    with open(os.path.join(HISTORY, datetime.date.today().isoformat() + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'date': datetime.date.today().isoformat(), 'slots': slots, 'library': lib}, f)


def learn():
    """Measures the last run against the library now, logs it, and returns the policy for this run."""
    policy = {'stats': {}, 'runs': 0}
    if os.path.exists(POLICY):
        with open(POLICY, encoding='utf-8') as f:
            policy = json.load(f)
    runs = sorted(n for n in os.listdir(HISTORY) if n.endswith('.json')) if os.path.isdir(HISTORY) else []
    last = None
    if runs:
        with open(os.path.join(HISTORY, runs[-1]), encoding='utf-8') as f:
            last = json.load(f)
    lib = library()
    if last and last.get('library') is not None and lib is not None and last['date'] != datetime.date.today().isoformat():
        before = last['library']
        delta = dict((i, (max(0, w - before.get(i, (0, 0))[0]), max(0, n - before.get(i, (0, 0))[1]))) for i, (w, n) in lib.items())
        total = sum(w for w, _ in delta.values()) / 60000.0
        per = {}
        for s_ in last['slots']:
            w, n = delta.get(s_['id'], (0, 0))
            m = per.setdefault(s_['slot'], {'shown': 0, 'started': 0, 'finished': 0, 'minutes': 0.0})
            m['shown'] += 1
            m['started'] += 1 if w >= 600000 else 0
            m['finished'] += 1 if n else 0
            m['minutes'] += w / 60000.0
        curated = sum(m['minutes'] for m in per.values())
        line = {'date': datetime.date.today().isoformat(), 'since': last['date'], 'minutes_all': round(total),
                'minutes_curated': round(curated), 'share_curated': round(curated / total, 3) if total else 0,
                'slots': dict((k, dict(v, minutes=round(v['minutes']))) for k, v in per.items()),
                'quota': policy.get('quota')}
        with open(METRICS, 'a', encoding='utf-8') as f:
            f.write(json.dumps(line, ensure_ascii=False) + '\n')
        print('curation: since %s he watched %d min, %d of them from the home\'s picks and rows (%d%%)' % (
            last['date'], total, curated, 100 * line['share_curated']))
        for k, v in sorted(per.items()):
            print('  %-14s shown %3d · started %2d · finished %2d · %4d min' % (k, v['shown'], v['started'], v['finished'], v['minutes']))
        # Older runs count less (half after ~3 runs): his taste and the catalog move.
        for k in set(policy['stats']) | set(per):
            old = policy['stats'].get(k, {'shown': 0, 'started': 0, 'minutes': 0})
            new = per.get(k, {'shown': 0, 'started': 0, 'minutes': 0})
            policy['stats'][k] = dict((f, round(0.8 * old.get(f, 0) + new.get(f, 0), 2)) for f in ('shown', 'started', 'minutes'))
        policy['runs'] = policy.get('runs', 0) + 1
    # Rows per kind for this run: a draw of how often each kind gets started, times how long a start lasts.
    rnd = random.Random(datetime.date.today().toordinal())
    weight = {}
    for k in KINDS:
        st = policy['stats'].get('row:' + k, {})
        shown_, started = st.get('shown', 0), st.get('started', 0)
        rate = rnd.betavariate(1 + started, 1 + max(0, shown_ - started) / 4.0)     # a start in 4 shown is a good row
        length = (st.get('minutes', 0) + 60) / (started + 1)                          # a film's hour as the prior
        weight[k] = rate * length
    # The first curation's mix is the base (he liked it); with enough data, the kind that holds him most gains a row
    # from the one that holds him least. Never more than one row moves per run.
    quota = {'because': 3, 'director': 3, 'theme': 2, 'country': 2}
    measured = [k for k in KINDS if policy['stats'].get('row:' + k, {}).get('shown', 0) >= 20]
    starts = sum(policy['stats'].get('row:' + k, {}).get('started', 0) for k in KINDS)
    if len(measured) >= 2 and starts >= 3:                  # a few films started, not one peek
        best_k = max(measured, key=lambda k: weight[k])
        worst_k = min(measured, key=lambda k: weight[k])
        if best_k != worst_k and weight[best_k] > 1.5 * weight[worst_k] and quota[worst_k] > 1:
            quota[best_k] += 1; quota[worst_k] -= 1
    policy['quota'] = quota
    os.makedirs(OUT, exist_ok=True)
    with open(POLICY, 'w', encoding='utf-8') as f:
        json.dump(policy, f, indent=1)
    print('curation: rows this run: %s' % ', '.join('%s %d' % (k, quota[k]) for k in KINDS))
    return policy


# MARK: - The run

def build_info(ids):
    ids = [i for i in ids if i]
    return {i: d for i, d in zip(ids, parallel(details, ids)) if d}


def entry(d, line, group=''):
    return {'id': d['external_ids']['imdb_id'], 'tmdb': d['id'], 'type': 'movie', 'group': group, 'title': d.get('title'),
            'original': d.get('original_title'), 'year': int((d.get('release_date') or '0')[:4] or 0),
            'runtime': d.get('runtime') or 0, 'genres': [x['name'] for x in d.get('genres', [])][:2],
            'rating': ('%.1f' % (d.get('vote_average') or 0)).replace('.', ','), 'desc': d.get('overview') or '',
            'backdrop': d.get('backdrop_path') or '', 'poster': d.get('poster_path') or '', 'why': line}


# MARK: - The personal rows (Netflix style): each one has its own reason, and they change every week

def discover(**params):
    ids = []
    for page in (1, 2):
        o = tmdb('/discover/movie', page=page, **params)
        ids += [m['id'] for m in (o or {}).get('results', [])]
    return ids


# What a film shares with the 5★ film its row starts from, most telling first.
LINK = (('d', 'Também de %s'), ('w', 'Também com roteiro de %s'), ('c', 'Também com %s'), ('p', 'Também com fotografia de %s'),
        ('k', 'Também sobre %s'), ('o', 'Também cinema %s'))


LINK_PT = {'cinema queer': 'temática LGBT+'}
# Themes that read better another way than "Também sobre …".
LINK_THEME = {'temática LGBT+': 'Também com temática LGBT+', 'sátira': 'Também uma sátira', 'humor ácido': 'Também com humor ácido'}


def link(d, seed):
    """How strongly d comes from seed (a person counts 2, a theme or the country 1, the decade ½; a genre is too wide), and
    the lines that say it, each with its feature."""
    shared, n = set(features(d)) & set(features(seed)), names(seed)
    kw = dict((('k:%d' % k['id']), k['name'].lower()) for k in (seed.get('keywords') or {}).get('keywords', []))
    out, strength = [], 0
    for f in shared:
        strength += 2 if f[0] in 'dwcp' else 1 if f[0] in 'ko' else 0.5 if f[0] == 'y' else 0
    for kind, text in LINK:
        for f in sorted(x for x in shared if x[0] == kind):
            if kind == 'k':
                name = KW_PT.get(kw.get(f))
                name = LINK_PT.get(name, name)
            elif kind == 'o':
                name = COUNTRY_PT.get(f[2:]) if f[2:] != 'US' else None
            else:
                name = n.get(f) if re.search('[A-Za-z]', n.get(f, '')) else None
            if name:
                out.append((LINK_THEME.get(name, text % name) if kind == 'k' else text % name, f))
    return strength, out


def proper(d):
    """A feature film: no music videos, concert tapes or TV movies."""
    g = set(x['id'] for x in d.get('genres', []))
    return (d.get('runtime') or 0) >= 70 and not g & {10402, 10770} and not d.get('adult')


def personal_rows(rated, info, taste, best, idf, seen, wish, week, taken, quota=None, titles=None):
    """Seeds from his taste (5★ films, directors, themes, countries), rotating with the week. Each kind tries more
    seeds than it needs, in its own order, and keeps the first that fill a row."""
    ranked = sorted(((v, f) for f, v in taste.items() if v > 0 and f in best), reverse=True)
    people = {}
    for d in info.values():
        people.update(names(d))
    def shuffled(items, salt):
        items = list(items)
        random.Random(week * 100 + salt).shuffle(items)
        return items

    def because():
        for tid, rating, name, year in shuffled([r for r in rated if r[1] >= 5 and r[0] in info], 1)[:10]:
            d = info[tid]
            ids = [m['id'] for k in ('recommendations', 'similar') for m in (d.get(k) or {}).get('results', [])]
            # And what its director and writers made (Trier and Vogt for The Worst Person in the World).
            crew = (d.get('credits') or {}).get('crew', [])
            makers = [c['id'] for c in crew if c.get('job') == 'Director'] + [c['id'] for c in crew if c.get('department') == 'Writing'][:2]
            for p in dict.fromkeys(makers):
                ids += made(p)[:30]
            yield 'Porque você deu 5★ em %s' % name, ids, d

    def directors():
        for f in shuffled([f for _, f in ranked if f[0] == 'd'][:10], 2):
            yield 'Mais de %s' % people.get(f, ''), made(f[2:], ('Director',)), f

    def themes():
        found = []
        for _, f in ranked:
            if f[0] == 'k':
                o = tmdb('/keyword/%s' % f[2:]) or {}
                if o.get('name', '').lower() in KW_PT:
                    found.append((f, KW_PT[o['name'].lower()]))
            if len(found) == 10:
                break
        for f, label in shuffled(found, 3):
            yield label[0].upper() + label[1:], discover(with_keywords=f[2:], sort_by='vote_average.desc', **{'vote_count.gte': 150}), f

    def countries():
        top = [f for _, f in ranked if f[0] == 'o' and f[2:] in COUNTRY_PT][:5]
        for f in top[:1] + shuffled(top[1:], 4):
            yield 'Cinema ' + COUNTRY_PT[f[2:]], discover(with_origin_country=f[2:], sort_by='vote_average.desc', **{'vote_count.gte': 200}), f

    rows = []
    quota = quota or {'because': 3, 'director': 3, 'theme': 2, 'country': 2}
    gens = {'because': because, 'director': directors, 'theme': themes, 'country': countries}
    for kind in sorted(gens, key=lambda k: -quota.get(k, 0)):
        gen, want = gens[kind], quota.get(kind, 0)
        got = 0
        for title, ids, seed in gen():
            if got == want:
                break
            if titles is not None and title in titles:          # an earlier deck has this row already
                continue
            row = make_row(kind, title, ids, seed, taste, best, idf, seen, wish, taken)
            if row:
                rows.append(row)
                got += 1
    # Netflix-like: the kinds take turns down the home, the one he watches most first.
    order = dict((k, i) for i, k in enumerate(sorted(gens, key=lambda k: -quota.get(k, 0))))
    turn = {}
    for r in rows:
        turn[id(r)] = sum(1 for x in rows[:rows.index(r)] if x['kind'] == r['kind'])
    return sorted(rows, key=lambda r: (turn[id(r)], order[r['kind']]))


def made(person, jobs=('Director', 'Screenplay', 'Writer')):
    o = tmdb('/person/%s/movie_credits' % person) or {}
    return [m['id'] for m in o.get('crew', []) if m.get('job') in jobs]


def make_row(kind, title, ids, seed, taste, best, idf, seen, wish, taken):
    # A film shows once on the home: not in the picks, not in an earlier row.
    ids = [i for i in dict.fromkeys(ids) if i not in seen and i not in taken]
    docs = [d for d in build_info(ids).values() if (d.get('external_ids') or {}).get('imdb_id') and proper(d)
            and re.search('[A-Za-z]', d.get('title') or '')]      # no 남극일기 on the home
    said = {}                                               # in a row too, a reason at most twice
    if kind == 'director':
        # His own films, not anthologies where he made one segment (Paris, Te Amo).
        def directors(d):
            return [c['id'] for c in (d.get('credits') or {}).get('crew', []) if c.get('job') == 'Director']
        docs = [d for d in docs if int(seed[2:]) in directors(d) and len(directors(d)) <= 2]
    if kind == 'because':
        # Only what really comes from that film: one person in common, or two other ties (Argentina and the 70s,
        # not just one theme).
        links = dict((d['id'], link(d, seed)) for d in docs)
        docs = [d for d in docs if links[d['id']][0] >= 2 and links[d['id']][1]]
        docs.sort(key=lambda d: (-min(links[d['id']][0], 4), -score(d, taste, wish, idf)))
        def line(d):
            # The tie to the seed, then one of his own reasons when there is one (they end in the stars).
            first, f = links[d['id']][1][0]
            rest = why(d, taste, best, idf, said, skip=f, bare=False).split(' · ')[0]
            return first + (' · ' + rest if rest.endswith(')') and seed.get('title', '') not in rest else '')
        lines = dict((d['id'], line(d)) for d in docs[:28])
    else:
        docs.sort(key=lambda d: -score(d, taste, wish, idf))
        lines = dict((d['id'], why(d, taste, best, idf, said, skip=seed, bare=False)) for d in docs)
        if kind == 'theme':
            # A wide theme ("violência policial") needs a second tie to him, or Rambo gets in.
            docs = [d for d in docs if lines[d['id']]]
        # Films with a reason of his own first.
        docs.sort(key=lambda d: (not lines[d['id']], -score(d, taste, wish, idf)))
        # Japan is more than anime: at most three animated films in a row about a place or a theme.
        cartoons = [d for d in docs if 16 in [g['id'] for g in d.get('genres', [])]][3:]
        docs = [d for d in docs if d not in cartoons]
    # Rows as full as Netflix's: up to 15, and none under 8 (two films isn't a list).
    docs = docs[:28]
    ok = parallel(lambda d: cached(d['external_ids']['imdb_id']), docs, workers=6)
    items = [entry(d, lines[d['id']]) for d, good in zip(docs, ok) if good][:15]
    print('curation: row "%s": %d of %d cached' % (title, len(items), len(docs)))
    if len(items) < (6 if kind == 'director' else 8):
        return None
    taken.update(x['tmdb'] for x in items)
    return {'title': title, 'kind': kind, 'items': items}


def pick(args):
    rated, liked, seen, wish = load_history(args.letterboxd)
    info = build_info(set(t for t, _, _, _ in rated))
    taste, best, mean = profile(rated, liked, info)
    pool = candidate_ids(rated, info, wish) - seen
    cand = build_info(pool)
    idf = rarity(list(cand.values()))
    ranked = sorted((d for d in cand.values() if not d.get('adult') and (d.get('runtime') or 90) >= 60),
                    key=lambda d: -score(d, taste, wish, idf))
    # Each of the app's chips (Lançamentos, Clássicos) gets a full row of its own.
    quota = {'new': 12, 'classic': 12, 'mix': 12}
    def group(d):
        y = int((d.get('release_date') or '0')[:4] or 0)
        return 'new' if y >= THIS_YEAR - 3 else 'classic' if y and y < 1990 else 'mix'
    st = {'queue': [d for d in ranked if (d.get('external_ids') or {}).get('imdb_id')], 'checked': 0}

    def choose(used):
        """The best-ranked cached films not used yet, by group: one deck's picks."""
        groups, reason_count, later = {'new': [], 'classic': [], 'mix': []}, {}, []
        while st['queue'] and any(len(groups[g]) < quota[g] for g in groups):
            batch, st['queue'] = st['queue'][:24], st['queue'][24:]
            later += [d for d in batch if d['id'] not in used and len(groups[group(d)]) >= quota[group(d)]]
            batch = [d for d in batch if d['id'] not in used and len(groups[group(d)]) < quota[group(d)]]
            ok = parallel(lambda d: cached(d['external_ids']['imdb_id']), batch, workers=6)
            st['checked'] += len(batch)
            for d, good in zip(batch, ok):
                g, main = group(d), main_reason(d, taste, best, idf)
                # Variety: at most two picks for the same reason (the same director, the same theme).
                if good and len(groups[g]) < quota[g] and reason_count.get(main, 0) < 2:
                    groups[g].append(d)
                    reason_count[main] = reason_count.get(main, 0) + 1
        st['queue'] = later + st['queue']                   # what a full group passed over, for the next deck
        picks, said = [], {}
        for g in ('new', 'mix', 'classic'):
            for d in groups[g]:
                picks.append(dict(entry(d, why(d, taste, best, idf, said), g), score=round(score(d, taste, wish, idf), 3)))
        return picks, groups

    os.makedirs(OUT, exist_ok=True)
    # Two runs a week (Monday, Thursday): each one its own seeds.
    today = datetime.date.today()
    week = today.isocalendar()[1] + (1000 if today.weekday() >= 3 else 0)
    policy = learn()
    # Decks: the home's refresh button moves to the next one on the TV, offline. Same algorithm, other seeds, and
    # nothing repeats across decks.
    decks, used, titles = [], set(), set()
    for k in range(max(1, int(os.environ.get('SOFA_DECKS', '3')))):
        dp, groups_k = choose(used)
        used.update(p['tmdb'] for p in dp)
        dr = personal_rows(rated, info, taste, best, idf, seen, wish, week + 7919 * k, set(used), policy.get('quota'), titles)
        titles.update(r['title'] for r in dr)
        for r in dr:
            used.update(x['tmdb'] for x in r['items'])
        decks.append({'picks': dp, 'rows': dr})
        if k == 0:
            groups = groups_k
        print('curation: deck %d: %d picks, %d rows' % (k + 1, len(dp), len(dr)))
    picks, rows, checked = decks[0]['picks'], decks[0]['rows'], st['checked']
    out = {'week': datetime.date.today().isoformat(), 'mean': round(mean, 2), 'checked_in_debrid': checked, 'picks': picks, 'rows': rows,
           'decks': decks}
    with open(os.path.join(OUT, 'picks.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    shown(out)
    print('curation: %d picks (%s), %d checked in the debrid, from %d candidates' % (
        len(picks), ', '.join('%d %s' % (len(groups[g]), g) for g in groups), checked, len(ranked)))
    for p in picks:
        print('  [%s] %s (%d) · %s' % (p['group'], p['title'], p['year'], p['why']))
    if os.path.exists(TRAKT_TOKEN):
        trakt_list(picks)


def backtest(args):
    """Hides 20% of his 4.5★+ films, learns from the rest, and looks for the hidden ones among the candidates."""
    rated, liked, seen, wish = load_history(args.letterboxd)
    info = build_info(set(t for t, _, _, _ in rated))
    top = [r for r in rated if r[1] >= 4.5]
    rows = []
    for seed in range(args.rounds):
        rnd = random.Random(seed)
        hidden = set(t for t, _, _, _ in rnd.sample(top, max(1, len(top) // 5)))
        train = [r for r in rated if r[0] not in hidden]
        taste, best, _ = profile(train, liked - hidden, info)
        pool = candidate_ids(train, info, wish - hidden) - (seen - hidden)
        cand = build_info(pool)
        found = [h for h in hidden if h in cand]
        idf = rarity(list(cand.values()))
        ranked = sorted(cand.values(), key=lambda d: -score(d, taste, wish - hidden, idf))
        pop = sorted(cand.values(), key=lambda d: -(d.get('popularity') or 0))
        pos = {d['id']: i + 1 for i, d in enumerate(ranked)}
        ppos = {d['id']: i + 1 for i, d in enumerate(pop)}
        rows.append({'hidden': len(hidden), 'in_pool': len(found), 'pool': len(ranked),
                     'at50': sum(1 for h in found if pos[h] <= 50), 'at100': sum(1 for h in found if pos[h] <= 100),
                     'pop_at100': sum(1 for h in found if ppos[h] <= 100),
                     'median_pct': sorted(pos[h] / len(ranked) for h in found)[len(found) // 2] if found else 1})
        print('round %d: %d hidden, %d in the pool of %d, %d in the top 50, %d in the top 100 (popularity: %d), median at %.0f%%' % (
            seed + 1, rows[-1]['hidden'], rows[-1]['in_pool'], rows[-1]['pool'], rows[-1]['at50'], rows[-1]['at100'],
            rows[-1]['pop_at100'], rows[-1]['median_pct'] * 100))
    total = sum(r['hidden'] for r in rows)
    summary = {'rounds': rows, 'hidden': total, 'recall_at_100': round(sum(r['at100'] for r in rows) / total, 3),
               'popularity_recall_at_100': round(sum(r['pop_at100'] for r in rows) / total, 3),
               'recall_at_50': round(sum(r['at50'] for r in rows) / total, 3)}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'backtest.json'), 'w') as f:
        json.dump(summary, f, indent=1)
    print('backtest: top 50 %.0f%%, top 100 %.0f%% of the hidden films (by popularity alone: %.0f%%)' % (
        summary['recall_at_50'] * 100, summary['recall_at_100'] * 100, summary['popularity_recall_at_100'] * 100))


# MARK: - Trakt

def trakt_headers(token=None):
    h = {'trakt-api-version': '2', 'trakt-api-key': CFG.get('trakt_client_id', '')}
    if token:
        h['Authorization'] = 'Bearer ' + token
    return h


def with_secret(o):
    if CFG.get('trakt_client_secret'):
        o['client_secret'] = CFG['trakt_client_secret']
    return o


def trakt_login():
    st, o = http('https://api.trakt.tv/oauth/device/code', {'client_id': CFG.get('trakt_client_id', '')}, trakt_headers())
    if st != 200:
        sys.exit('trakt: no device code (%s)' % st)
    print('Open %s and type %s' % (o['verification_url'], o['user_code']))
    until = time.time() + o['expires_in']
    while time.time() < until:
        time.sleep(o.get('interval', 5))
        st, t = http('https://api.trakt.tv/oauth/device/token', with_secret({'code': o['device_code'], 'client_id': CFG['trakt_client_id']}), trakt_headers())
        if st == 200:
            t['expires_at'] = t['created_at'] + t['expires_in']
            with open(TRAKT_TOKEN, 'w') as f:
                json.dump(t, f)
            os.chmod(TRAKT_TOKEN, 0o600)
            print('trakt: signed in')
            return
        if st not in (400, 429):
            sys.exit('trakt: refused (%s)' % st)
    sys.exit('trakt: the code expired')


def trakt_token():
    with open(TRAKT_TOKEN) as f:
        t = json.load(f)
    if time.time() > t['expires_at'] - 86400:
        st, n = http('https://api.trakt.tv/oauth/token', with_secret({'refresh_token': t['refresh_token'], 'client_id': CFG['trakt_client_id'],
                     'redirect_uri': 'urn:ietf:wg:oauth:2.0:oob', 'grant_type': 'refresh_token'}), trakt_headers())
        if st == 200:
            n['expires_at'] = n['created_at'] + n['expires_in']
            t = n
            with open(TRAKT_TOKEN, 'w') as f:
                json.dump(t, f)
    return t['access_token']


def trakt_list(picks):
    token, name = trakt_token(), 'Sofá · Curadoria da semana'
    st, lists = http('https://api.trakt.tv/users/me/lists', headers=trakt_headers(token))
    if st != 200:
        print('trakt: lists not readable (%s)' % st, file=sys.stderr)
        return
    found = next((l for l in lists or [] if l['name'] == name), None)
    if not found:
        st, found = http('https://api.trakt.tv/users/me/lists', {'name': name, 'privacy': 'private', 'display_numbers': True,
                         'description': 'Toda segunda: filmes perto do seu gosto, já em cache no TorBox.'}, trakt_headers(token))
    slug = found['ids']['trakt']
    st, items = http('https://api.trakt.tv/users/me/lists/%s/items/movie' % slug, headers=trakt_headers(token))
    old = [{'ids': {'trakt': i['movie']['ids']['trakt']}} for i in items or []]
    if old:
        http('https://api.trakt.tv/users/me/lists/%s/items/remove' % slug, {'movies': old}, trakt_headers(token))
    st, _ = http('https://api.trakt.tv/users/me/lists/%s/items' % slug, {'movies': [{'ids': {'imdb': p['id']}, 'notes': p['why'][:500]} for p in picks]},
                 trakt_headers(token))
    print('trakt: list "%s" updated (%s)' % (name, st))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--letterboxd', help='the unzipped Letterboxd export')
    a.add_argument('--backtest', action='store_true')
    a.add_argument('--rounds', type=int, default=5)
    a.add_argument('--trakt-login', action='store_true')
    args = a.parse_args()
    if args.trakt_login:
        return trakt_login()
    if not CFG.get('tmdb_key'):
        sys.exit('curation: needs tmdb_key in config.properties')
    if not args.letterboxd:
        sys.exit('curation: --letterboxd <folder of the export>')
    args.letterboxd = os.path.expanduser(args.letterboxd)
    if args.backtest:
        backtest(args)
    else:
        pick(args)


if __name__ == '__main__':
    main()
