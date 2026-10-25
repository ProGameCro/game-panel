#!/bin/sh
# Runs B3 with the files the panel user uploaded to the server folder b3/ (seen here as /data/b3).
# The B3 that runs: b3/ itself when it holds b3_run.py (Install B3 puts the B3 there), else b3/app, else /opt/b3.
B=/data/b3
mkdir -p "$B/logs"
LOG="$B/logs/console.log"
[ -f "$LOG" ] && mv -f "$LOG" "$B/logs/console.previous.log"
exec >>"$LOG" 2>&1
echo "[$(date '+%F %T')] starting B3"
APP=/opt/b3
# own B3 directly in b3/app, or one folder deeper (e.g. b3/app/big-brother-bot after uploading a folder or zip)
OWN=""
if [ -f "$B/b3_run.py" ]; then OWN="$B"; elif [ -f "$B/app/b3_run.py" ]; then OWN="$B/app"; else
  for d in "$B"/app/*/; do [ -f "${d}b3_run.py" ] && { OWN="${d%/}"; break; }; done
fi
if [ -n "$OWN" ]; then
  APP="$OWN"
  echo "using your B3 from ${APP#/data/}"
  # extra Python modules of that B3 go to b3/.local (installed again only when requirements.txt changes)
  # (skipped when they are the same as the built-in B3's, which are already installed)
  if [ -f "$APP/requirements.txt" ] && ! cmp -s "$APP/requirements.txt" /opt/b3/requirements.txt; then
    sum=$(md5sum "$APP/requirements.txt" | cut -d' ' -f1)
    if [ "$(cat "$B/.local/requirements.md5" 2>/dev/null)" != "$sum" ]; then
      echo "installing requirements.txt ..."
      pip install --user -q --disable-pip-version-check --no-warn-script-location -r "$APP/requirements.txt" \
        && mkdir -p "$B/.local" && echo "$sum" > "$B/.local/requirements.md5"
    fi
  fi
else
  echo "using the built-in B3 1.12"
fi
# parsers and plugins from b3/parsers and b3/extplugins are copied into B3 so "parser: name" and plugin names just work
if [ -d "$APP/b3/parsers" ]; then
  for f in "$B"/parsers/*.py; do [ -f "$f" ] && cp -f "$f" "$APP/b3/parsers/" && echo "parser: $(basename "$f")"; done
fi
if [ -d "$B/extplugins" ] && [ -d "$APP/b3/extplugins" ]; then cp -rf "$B"/extplugins/. "$APP/b3/extplugins/" 2>/dev/null; fi
CFG="${B3_CONFIG:-}"
if [ -z "$CFG" ]; then
  for c in "$APP/b3/conf/b3.xml" "$APP/b3/conf/b3.ini" "$B/conf/b3.xml" "$B/conf/b3.ini" "$B/b3.xml" "$B/b3.ini"; do [ -f "$c" ] && { CFG="$c"; break; }; done
fi
[ -n "$CFG" ] && [ -f "$CFG" ] || { echo "No B3 config found (b3/conf/b3.ini or b3.xml)"; exit 3; }
echo "config: $CFG"
cd "$APP"
exec python b3_run.py --restart --config "$CFG"
