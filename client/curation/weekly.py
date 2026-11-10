#!/usr/bin/env python3
"""The curation's run, on the computer that is on most of the time (macOS, Linux or Windows).

The scheduler (launchd's sofa.curation.plist on a Mac, Task Scheduler on Windows: see windows-task.ps1) calls this
every hour and at login; the script decides what is due, so a computer that was asleep or off on the day catches up
the moment it's back:

  1. Monday and Thursday from 8:00: this run's picks and the Trakt list (once per day of run; a run that fails is
     tried again the next hour).
  2. Publishes picks.json where every TV looks for it (SOFA_PUBLISH: a branch served by GitHub Pages; picks_url in
     config.properties is its address): every TV gets the new picks without a new install.
  3. Optional, only with SOFA_TV set (a Fire TV's ip:5555, and the Android tools on this computer): installs a Sofá
     Player with the new picks inside, only when the TV is reachable and nothing is playing; until then it stays
     pending and is tried again every hour.

    python3 client/curation/weekly.py            what is due
    python3 client/curation/weekly.py --now      a new run now, whatever the day
    python3 client/curation/weekly.py --status   what was done and what is pending (changes nothing)

Settings, from the environment or from client/curation/weekly.env (KEY=value lines; not in git):
SOFA_LETTERBOXD (the Letterboxd export folder, required), SOFA_PUBLISH, SOFA_TV; for another profile also SOFA_OUT (its
state folder), SOFA_CONFIG (its config.properties), SOFA_PICKS_NAME (picks-<name>.json) and SOFA_TRAKT_TOKEN. SOFA_ENV
points to another weekly.env (one per profile). Python 3 standard library only.
Logs to the scheduler's log (~/Library/Logs/sofa-curation.log on a Mac, client/curation/out/weekly.log on Windows).
"""
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def load_env(path):
    """weekly.env's KEY=value lines, under what the environment already says (the scheduler can override a line)."""
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


load_env(os.environ.get('SOFA_ENV') or os.path.join(HERE, 'weekly.env'))
OUT = os.path.abspath(os.path.expanduser(os.environ.get('SOFA_OUT') or os.path.join(HERE, 'out')))
PICKS = os.path.join(OUT, 'picks.json')
# The published file's name: picks.json for the house, picks-<profile>.json for another profile.
NAME = os.environ.get('SOFA_PICKS_NAME') or 'picks.json'
LOCK = os.path.join(OUT, '.running')


def slot(now=None):
    """The day of run this moment belongs to: the last Monday or Thursday whose 8:00 has passed."""
    now = now or datetime.datetime.now()
    for back in range(8):
        d = (now - datetime.timedelta(days=back)).replace(hour=8, minute=0, second=0, microsecond=0)
        if d.weekday() in (0, 3) and d <= now:
            return d.date().isoformat()


def stamp(name, value=None):
    path = os.path.join(OUT, name)
    if value is not None:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(value + '\n')
        return value
    return open(path, encoding='utf-8').read().strip() if os.path.exists(path) else ''


def week():
    """This run's date and a short fingerprint of its picks: a second run on the same day publishes again."""
    try:
        with open(PICKS, 'rb') as f:
            body = f.read()
        return '%s:%s' % (json.loads(body.decode('utf-8')).get('week', ''), hashlib.sha1(body).hexdigest()[:8])
    except (OSError, ValueError):
        return ''


def say(text):
    print('%s %s' % (datetime.datetime.now().strftime('%d/%m %H:%M'), text), flush=True)


# Titles and stars are not ASCII: on Windows, Python would otherwise fail writing them to the log.
ENV = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')


def run(cmd, cwd=ROOT, quiet=False):
    return subprocess.call(cmd, cwd=cwd, env=ENV, stdout=subprocess.DEVNULL if quiet else None, stderr=subprocess.STDOUT if not quiet else subprocess.DEVNULL)


def publish(branch, wk):
    """picks.json onto the branch GitHub Pages serves, through a worktree of its own (the checkout here isn't touched)."""
    pages = os.path.join(HERE, 'out', 'pages')            # shared by every profile: one checkout of the branch
    if not os.path.isdir(pages):
        if run(['git', 'fetch', '-q', 'origin', branch]) or run(['git', 'worktree', 'add', '-q', '--detach', pages, 'origin/' + branch]):
            return False
    if run(['git', 'fetch', '-q', 'origin', branch], cwd=pages) or run(['git', 'checkout', '-q', '--detach', 'origin/' + branch], cwd=pages):
        return False
    shutil.copy(PICKS, os.path.join(pages, NAME))
    run(['git', 'add', NAME], cwd=pages)
    if run(['git', 'diff', '--cached', '--quiet'], cwd=pages):
        if run(['git', '-c', 'user.name=Sofá', '-c', 'user.email=sofa@localhost', 'commit', '-q', '-m', 'Curadoria de ' + wk], cwd=pages):
            return False
    return run(['git', 'push', '-q', 'origin', 'HEAD:' + branch], cwd=pages) == 0


def playing(tv):
    """Never in the middle of a film: playing means a media session in state 3."""
    try:
        out = subprocess.check_output(['adb', '-s', tv, 'shell', 'dumpsys', 'media_session'], stderr=subprocess.DEVNULL, timeout=30).decode('utf-8', 'replace')
    except Exception:
        return True                                         # can't tell: don't install
    return 'state=PlaybackState {state=3' in out


def install(tv, wk):
    if not shutil.which('adb') or not shutil.which('bash'):
        say('no adb or bash on this computer: the Fire TV keeps the picks it fetches from the network')
        return
    run(['adb', 'connect', tv], quiet=True)
    if run(['adb', '-s', tv, 'get-state'], quiet=True):
        say('Fire TV not reachable: the install waits')
        return
    if playing(tv):
        say('something is playing on the Fire TV: the install waits')
        return
    if run(['bash', './build.sh', '--proto'], cwd=os.path.join(ROOT, 'firetv')):
        say('build failed')
        return
    if playing(tv):
        say('something started playing during the build: the install waits')
        return
    if run(['adb', '-s', tv, 'install', '-r', os.path.join(ROOT, 'firetv', 'Sofa-Player.apk')]) == 0:
        stamp('installed-firetv', wk)
        say('installed the picks of %s on the Fire TV' % wk)


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    s = os.environ
    os.makedirs(OUT, exist_ok=True)
    today = slot()
    if arg == '--status':
        print('day of run: %s · last run: %s · picks: %s · published: %s · on the Fire TV: %s' % (
            today, stamp('last-run') or '-', week() or '-', stamp('published') or '-', stamp('installed-firetv') or '-'))
        return 0
    if not s.get('SOFA_LETTERBOXD'):
        say('set SOFA_LETTERBOXD to your Letterboxd export folder (environment or client/curation/weekly.env)')
        return 1
    # One at a time: an hourly call must not start over a run still going (a lock older than 3 hours is a dead one).
    try:
        os.mkdir(LOCK)
    except FileExistsError:
        if time.time() - os.path.getmtime(LOCK) < 3 * 3600:
            return 0
        os.utime(LOCK, None)
    try:
        if arg == '--now' or stamp('last-run') != today:
            say('== run of %s ==' % today)
            if run([sys.executable, os.path.join(HERE, 'curate.py'), '--letterboxd', os.path.expanduser(s['SOFA_LETTERBOXD'])]):
                say('curation failed: trying again in an hour')
                return 1
            stamp('last-run', today)
        wk = week()
        if not wk:
            return 0
        if s.get('SOFA_PUBLISH') and stamp('published') != wk:
            if publish(s['SOFA_PUBLISH'], wk):
                stamp('published', wk)
                say('published the picks of %s' % wk)
            else:
                say('publishing failed: trying again in an hour')
        if s.get('SOFA_TV') and stamp('installed-firetv') != wk:
            install(s['SOFA_TV'], wk)
        return 0
    finally:
        try:
            os.rmdir(LOCK)
        except OSError:
            pass


if __name__ == '__main__':
    sys.exit(main())
