#!/bin/bash
# launchd's entry (sofa.curation.plist) to weekly.py, which does the work on any system: see it for what runs when.
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
exec python3 client/curation/weekly.py "$@"
