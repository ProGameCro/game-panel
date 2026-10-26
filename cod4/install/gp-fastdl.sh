#!/usr/bin/env bash
# OVHcloud Game Panel: FastDL for Call of Duty 4 (mods and custom maps download over HTTP, like on TCAdmin).
#  - Files: /var/www/html/cod4 (mods/<mod>/..., usermaps/<map>/...), served at http://<panel domain>:8080/cod4
#  - Sync: the service gamepanel-fastdl watches every CoD4 server (and /opt/gamepanel/cod4-linux) and keeps the
#    folder up to date by itself: new or changed .ff / .iwd files appear within seconds, deleted ones disappear.
#    Only .ff and .iwd files are published (never configs). Big files are hard links (no extra disk space).
#    Opening the address or a folder in a browser gives 403: only the game files themselves can be downloaded.
# Usage (as root):
#   bash gp-fastdl.sh                 install / update (safe to run again)
#   FASTDL_PORT=8090 bash gp-fastdl.sh   another port
#   FASTDL_HOST=fastdl.example.org bash gp-fastdl.sh   another host name in the URL (default: the panel's domain)
#   bash gp-fastdl.sh --remove        remove the service and the web server (the folder stays)
set -euo pipefail
cd /
APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
WEB_ROOT="${FASTDL_ROOT:-/var/www/html}"
DIR="$WEB_ROOT/cod4"
PORT="${FASTDL_PORT:-8080}"
LIB=/usr/local/lib/gamepanel-fastdl
# state in the panel's data folder, so the panel can show it (Command line card > FastDL)
STATE="$APP_ROOT/data/fastdl"
ETC=/etc/gamepanel-fastdl
NAME=gamepanel-fastdl
IMAGE=nginx:1.27-alpine
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
SYSTEMCTL="${GP_SYSTEMCTL:-systemctl}"

if [[ ${1:-} == --remove ]]; then
  $SYSTEMCTL disable --now $NAME >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/$NAME.service; $SYSTEMCTL daemon-reload || true
  docker rm -f $NAME >/dev/null 2>&1 || true
  echo "FastDL uklonjen. Datoteke su ostale u $DIR (obriši ih ručno ako ih ne trebaš)."
  exit 0
fi

[[ $PORT =~ ^[0-9]+$ && $PORT -ge 1 && $PORT -le 65535 ]] || { echo "Neispravan port: $PORT"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
command -v docker >/dev/null || { echo "Docker nije instaliran"; exit 1; }
# the port must be free (or already ours)
if ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . && [[ -z "$(docker ps -q -f name=^$NAME$)" ]]; then
  echo "Port $PORT je zauzet. Odaberi drugi: FASTDL_PORT=8090 bash $0"; exit 1
fi
mkdir -p "$DIR" "$LIB" "$STATE" "$ETC"

# ---- 1) the sync service ----------------------------------------------------------------------------------------
cat > "$LIB/gp-fastdl-sync.py" <<'PY'
#!/usr/bin/env python3
"""Keeps the FastDL folder in step with the CoD4 servers: mods/<mod>/*.ff|*.iwd and usermaps/<map>/*.ff|*.iwd.
Sources: every server folder with CoD4X (servers/*/data/serverfiles) and the cod4-linux folder.
Files are hard links where possible (same disk), copies otherwise. Only files this service created are ever deleted."""
import json, os, shutil, sys, time

APP_ROOT = os.environ.get('GP_APP_ROOT', '/opt/gamepanel')
TARGET = os.environ.get('FASTDL_DIR', '/var/www/html/cod4')
STATE = os.environ.get('FASTDL_STATE', '/opt/gamepanel/data/fastdl')
INTERVAL = float(os.environ.get('FASTDL_INTERVAL', '10'))
EXTENSIONS = ('.ff', '.iwd')
SECTIONS = ('mods', 'usermaps')
MANIFEST = os.path.join(STATE, 'manifest.json')

def sources():
    roots = [os.path.join(APP_ROOT, 'data', 'cod4-linux')]
    servers = os.path.join(APP_ROOT, 'servers')
    for key in sorted(os.listdir(servers)) if os.path.isdir(servers) else []:
        roots.append(os.path.join(servers, key, 'data', 'serverfiles'))
    return [r for r in roots if os.path.isfile(os.path.join(r, 'cod4x18_dedrun'))]

def wanted():
    """rel path -> source file (the newest one when several servers have the same file)"""
    result = {}
    for root in sources():
        for section in SECTIONS:
            base = os.path.join(root, section)
            if not os.path.isdir(base):
                continue
            for name in os.listdir(base):
                folder = os.path.join(base, name)
                if not os.path.isdir(folder) or name.startswith('.'):
                    continue
                for d, dirs, files in os.walk(folder):
                    dirs[:] = [x for x in dirs if not x.startswith('.')]
                    for f in files:
                        if not f.lower().endswith(EXTENSIONS):
                            continue
                        src = os.path.join(d, f)
                        if os.path.islink(src) or not os.path.isfile(src):
                            continue
                        rel = os.path.relpath(src, root)
                        old = result.get(rel)
                        if old is None or os.stat(src).st_mtime > os.stat(old).st_mtime:
                            result[rel] = src
    return result

def same(src, dst):
    try:
        a, b = os.stat(src), os.stat(dst)
    except FileNotFoundError:
        return False
    return (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino) or (a.st_size == b.st_size and int(a.st_mtime) == int(b.st_mtime))

def publish(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + '.gp-tmp'
    if os.path.lexists(tmp):
        os.remove(tmp)
    try:
        os.link(src, tmp)  # same file as the server's: no extra disk space, changes show up by themselves
    except OSError:
        shutil.copy2(src, tmp)  # another disk: a copy, readable by the web server
        os.chmod(tmp, 0o644)
    os.replace(tmp, dst)

def load_manifest():
    try:
        return set(json.load(open(MANIFEST)))
    except Exception:
        return set()

def save_manifest(paths):
    tmp = MANIFEST + '.tmp'
    json.dump(sorted(paths), open(tmp, 'w'))
    os.replace(tmp, MANIFEST)

def prune(path):
    d = os.path.dirname(path)
    while d.startswith(TARGET + os.sep) and d != TARGET:
        try:
            os.rmdir(d)
        except OSError:
            return
        d = os.path.dirname(d)

def sync_once():
    want = wanted()
    owned = load_manifest()
    added = removed = 0
    for rel, src in want.items():
        dst = os.path.join(TARGET, rel)
        if not same(src, dst):
            try:
                publish(src, dst)
                added += 1
            except OSError as e:
                print('cannot publish %s: %s' % (rel, e), flush=True)
                continue
        owned.add(rel)
    for rel in sorted(owned - set(want)):
        dst = os.path.join(TARGET, rel)
        try:
            os.remove(dst)
        except FileNotFoundError:
            pass
        prune(dst)
        owned.discard(rel)
        removed += 1
    save_manifest(owned)
    return added, removed, len(want)

def main():
    os.makedirs(TARGET, exist_ok=True)
    os.makedirs(STATE, exist_ok=True)
    once = '--once' in sys.argv
    while True:
        try:
            added, removed, total = sync_once()
            if added or removed or once:
                print('fastdl: %d files (%d new or changed, %d removed)' % (total, added, removed), flush=True)
        except Exception as e:
            print('fastdl sync failed: %s' % e, flush=True)
            if once:
                sys.exit(1)
        if once:
            return
        time.sleep(INTERVAL)

if __name__ == '__main__':
    main()
PY
chmod 755 "$LIB/gp-fastdl-sync.py"
cat > /etc/systemd/system/$NAME.service <<UNIT
[Unit]
Description=Game Panel FastDL sync (CoD4 mods and maps to $DIR)
After=network.target

[Service]
Environment=GP_APP_ROOT=$APP_ROOT FASTDL_DIR=$DIR FASTDL_STATE=$STATE
ExecStart=/usr/bin/python3 $LIB/gp-fastdl-sync.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
echo "== Prva sinkronizacija"
GP_APP_ROOT=$APP_ROOT FASTDL_DIR=$DIR FASTDL_STATE=$STATE python3 "$LIB/gp-fastdl-sync.py" --once
$SYSTEMCTL daemon-reload
$SYSTEMCTL enable $NAME >/dev/null 2>&1
$SYSTEMCTL restart $NAME

# ---- 2) the web server ------------------------------------------------------------------------------------------
cat > "$ETC/nginx.conf" <<'NGINX'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    autoindex off;
    server_tokens off;
    # only the game files themselves can be downloaded; folders, listings and anything else: 403
    location / {
        return 403;
    }
    location ~* ^/cod4/(mods|usermaps)/[^/]+/.+\.(ff|iwd)$ {
        limit_except GET HEAD { deny all; }
        types { }
        default_type application/octet-stream;
        try_files $uri =404;
    }
}
NGINX
docker image inspect $IMAGE >/dev/null 2>&1 || docker pull -q $IMAGE >/dev/null
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME --restart unless-stopped -p "$PORT:80" \
  -v "$WEB_ROOT:/usr/share/nginx/html:ro" -v "$ETC/nginx.conf:/etc/nginx/conf.d/default.conf:ro" $IMAGE >/dev/null
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null && echo "== Firewall (ufw): port $PORT otvoren"
fi

# ---- 3) how to use it -------------------------------------------------------------------------------------------
# the panel's domain (DOMAIN in deploy/.env, e.g. ovh.cod4x.org); FASTDL_HOST=... for another name
host="${FASTDL_HOST:-$(grep -E '^DOMAIN=' "$APP_ROOT/deploy/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")}"
[[ -n $host ]] || host="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
url="http://$host:$PORT/cod4"
echo "{\"url\": \"$url\"}" > "$STATE/fastdl.json"
sleep 1
test_file="$(cd "$DIR" && find . -type f \( -name '*.ff' -o -name '*.iwd' \) | head -1)"
if [[ -n $test_file ]]; then
  code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/cod4/${test_file#./}" || true)"
  [[ $code == 200 ]] && echo "== Web server radi (test: ${test_file#./})" || echo "== Web server ne odgovara (kod $code): docker logs $NAME"
fi
echo
echo "Gotovo. FastDL: $url"
echo "Datoteke: $DIR (mods: $(ls "$DIR/mods" 2>/dev/null | wc -l), usermaps: $(ls "$DIR/usermaps" 2>/dev/null | wc -l)); sinkronizacija svakih 10 s (servis $NAME)."
echo
echo "U server.cfg svakog CoD4 servera dodaj:"
echo "  set sv_allowDownload \"1\""
echo "  set sv_wwwDownload \"1\""
echo "  set sv_wwwBaseURL \"$url\""
echo "  set sv_wwwDlDisconnected \"0\""
echo "pa restartaj server. Log sinkronizacije: journalctl -u $NAME -f"
