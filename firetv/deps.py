#!/usr/bin/env python3
"""The Sofá Player's libraries, without Gradle: Media3 (ExoPlayer) and Jellyfin's build of its ffmpeg audio decoder.

Also fetches R8 (Google's dexer, a newer d8 than build-tools 34's 8.2, which crashes on Media3 1.7's classes) as
.deps/tools/r8.jar.
Reads each library's POM from Google's Maven and Maven Central, follows its compile and runtime dependencies, and
keeps the newest version of each. Leaves them in firetv/.deps/: the classes as .jar files (from the .aar files too)
and the ffmpeg native library under lib/<abi>/. Prints the jars, one per line, for build.sh.
Only ./firetv/build.sh --proto uses it.
"""
import io
import os
import re
import shutil
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

# Jellyfin's decoder 1.6.1+2 is built against Media3 1.7.1 (its POM asks for it), so that's ours.
MEDIA3 = '1.7.1'
FFMPEG = '1.6.1+2'
ROOTS = [('androidx.media3', 'media3-exoplayer', MEDIA3), ('org.jellyfin.media3', 'media3-ffmpeg-decoder', FFMPEG)]
# Annotations and the Kotlin library: nothing the player runs needs them, and they'd only make the APK bigger.
SKIP = re.compile(r'^(org\.jetbrains\.kotlin|org\.jetbrains|com\.google\.code\.findbugs|org\.checkerframework|'
                  r'com\.google\.errorprone|com\.google\.j2objc|org\.jspecify):')
REPOS = ['https://dl.google.com/android/maven2/', 'https://repo1.maven.org/maven2/']
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.deps')
ABIS = ('armeabi-v7a', 'arm64-v8a')
NS = '{http://maven.apache.org/POM/4.0.0}'


def fetch(path):
    for repo in (REPOS if not path.startswith('androidx/') and not path.startswith('com/android') else REPOS[:1]):
        try:
            with urllib.request.urlopen(urllib.request.Request(repo + path, headers={'User-Agent': 'sofa-deps'}), timeout=60) as r:
                return r.read()
        except Exception:
            continue
    return None


def cached(path):
    local = os.path.join(OUT, 'cache', path)
    if os.path.exists(local):
        with open(local, 'rb') as f:
            return f.read()
    data = fetch(path)
    if data is not None:
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, 'wb') as f:
            f.write(data)
    return data


def base(group, artifact, version):
    return '%s/%s/%s/%s-%s' % (group.replace('.', '/'), artifact, version, artifact, version)


def version_key(v):
    return [int(x) if x.isdigit() else x for x in re.split(r'[.+-]', v)]


def resolve():
    chosen, packaging, queue = {}, {}, []
    for g, a, v in ROOTS:
        queue.append((g, a, v))
    while queue:
        g, a, v = queue.pop(0)
        key = g + ':' + a
        if SKIP.match(key + ':'):
            continue
        if g == 'androidx.media3':
            v = MEDIA3   # all of Media3 at one version
        if key in chosen and version_key(chosen[key]) >= version_key(v):
            continue
        pom = cached(base(g, a, v) + '.pom')
        if pom is None:
            print('deps: no POM for %s:%s, skipped' % (key, v), file=sys.stderr)
            continue
        chosen[key] = v
        root = ET.fromstring(pom)
        p = root.find(NS + 'packaging')
        packaging[key] = p.text if p is not None else 'jar'
        for d in root.findall('%sdependencies/%sdependency' % (NS, NS)):
            def t(name):
                e = d.find(NS + name)
                return e.text.strip() if e is not None and e.text else ''
            if t('scope') in ('test', 'provided', 'system') or t('optional') == 'true':
                continue
            dv = t('version').strip('[]')
            if not dv or '$' in dv:
                continue
            queue.append((t('groupId'), t('artifactId'), dv))
    return chosen, packaging


def r8():
    """The newest stable R8 from Google's Maven, kept across builds."""
    jar = os.path.join(OUT, 'tools', 'r8.jar')
    if os.path.exists(jar):
        return
    data = fetch('com/android/tools/r8/maven-metadata.xml')
    if not data:
        sys.exit('deps: no answer from Google\'s Maven for R8; try again in a minute')
    stable = [v.text for v in ET.fromstring(data).iter('version') if re.match(r'^\d+\.\d+\.\d+$', v.text)]
    v = sorted(stable, key=version_key)[-1]
    data = fetch(base('com.android.tools', 'r8', v) + '.jar')
    if not data:
        sys.exit('deps: R8 %s didn\'t download; try again in a minute' % v)
    os.makedirs(os.path.dirname(jar), exist_ok=True)
    with open(jar, 'wb') as f:
        f.write(data)
    print('deps: R8 %s' % v, file=sys.stderr)


def main():
    r8()
    for d in ('jars', 'lib'):
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    chosen, packaging = resolve()
    jars = []
    for key, v in sorted(chosen.items()):
        g, a = key.split(':')
        if packaging[key] == 'pom':
            continue
        b = base(g, a, v)
        aar = cached(b + '.aar') if packaging[key] in ('aar', 'bundle') or g.startswith(('androidx', 'org.jellyfin')) else None
        if aar is not None:
            z = zipfile.ZipFile(io.BytesIO(aar))
            jar = os.path.join(OUT, 'jars', '%s-%s.jar' % (a, v))
            os.makedirs(os.path.dirname(jar), exist_ok=True)
            if 'classes.jar' in z.namelist():
                with open(jar, 'wb') as f:
                    f.write(z.read('classes.jar'))
                jars.append(jar)
            for name in z.namelist():
                parts = name.split('/')
                if parts[0] == 'jni' and len(parts) == 3 and parts[1] in ABIS and parts[2].endswith('.so'):
                    target = os.path.join(OUT, 'lib', parts[1], parts[2])
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target, 'wb') as f:
                        f.write(z.read(name))
                if parts[0] == 'res' and len(parts) > 2 and not parts[1].startswith('values'):
                    print('deps: %s has resources (%s); the player doesn\'t use them' % (key, name), file=sys.stderr)
            continue
        data = cached(b + '.jar')
        if data is None:
            print('deps: no jar for %s:%s, skipped' % (key, v), file=sys.stderr)
            continue
        jar = os.path.join(OUT, 'jars', '%s-%s.jar' % (a, v))
        os.makedirs(os.path.dirname(jar), exist_ok=True)
        with open(jar, 'wb') as f:
            f.write(data)
        jars.append(jar)
    print('deps: %d libraries (%s)' % (len(jars), ', '.join('%s %s' % (k.split(':')[1], v) for k, v in sorted(chosen.items())
                                                            if packaging[k] != 'pom')), file=sys.stderr)
    print('\n'.join(jars))


if __name__ == '__main__':
    main()
