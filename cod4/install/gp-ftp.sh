#!/usr/bin/env bash
# OVHcloud Game Panel: FTP, FTPS and SFTP access to the game servers' files (mods, maps, configs).
#  - One account per server (ftp<server number>), opened from the panel: server Settings > Game config > FTP access,
#    or Admin > FTP. The account sees the server's serverfiles folder, like the panel's File Manager.
#  - FTP and FTPS (explicit TLS, the panel's Let's Encrypt certificate) on port 21, passive ports 50000-50100;
#    SFTP on port 2022. Files uploaded this way belong to the game server's user, so the server can use them.
#  - Runs SFTPGo (container gamepanel-ftp); the panel manages the accounts through its API on the panel's own
#    network (not published). Too many wrong logins from one address block it for a while.
#  - Every upload, download, delete, rename and new folder is reported to the panel: Admin > FTP shows what each
#    server's account did (file, size, protocol, address) and who is connected now, with a button to disconnect.
# Usage (as root):
#   bash gp-ftp.sh                       install / update (safe to run again; accounts and passwords stay)
#   FTP_PORT=2121 SFTP_PORT=2222 bash gp-ftp.sh   other ports (FTP_PASSIVE=50000-50100 for the passive range)
#   FTP_PUBLIC_IP=1.2.3.4 bash gp-ftp.sh  the address FTP clients are sent to (default: the panel's domain)
#   bash gp-ftp.sh --remove              remove the service (the accounts' data stays in /etc/gamepanel-ftp)
set -euo pipefail
cd /
APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
NAME=gamepanel-ftp
IMAGE=drakkan/sftpgo:v2.6.6
ETC=/etc/gamepanel-ftp
STATE="$APP_ROOT/data/ftp"
FTP_PORT="${FTP_PORT:-21}"
SFTP_PORT="${SFTP_PORT:-2022}"
PASSIVE="${FTP_PASSIVE:-50000-50100}"
CERT_UNIT=gamepanel-ftp-cert
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
SYSTEMCTL="${GP_SYSTEMCTL:-systemctl}"

if [[ ${1:-} == --remove ]]; then
  $SYSTEMCTL disable --now $CERT_UNIT.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/$CERT_UNIT.service /etc/systemd/system/$CERT_UNIT.timer; $SYSTEMCTL daemon-reload || true
  docker rm -f $NAME >/dev/null 2>&1 || true
  rm -f "$STATE/ftp.json"
  echo "FTP uklonjen. Računi su ostali u $ETC (ponovna instalacija ih vrati)."
  exit 0
fi

command -v docker >/dev/null || { echo "Docker nije instaliran"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
for p in "$FTP_PORT" "$SFTP_PORT"; do
  [[ $p =~ ^[0-9]+$ && $p -ge 1 && $p -le 65535 ]] || { echo "Neispravan port: $p"; exit 1; }
done
[[ $PASSIVE =~ ^([0-9]+)-([0-9]+)$ && ${BASH_REMATCH[1]} -lt ${BASH_REMATCH[2]} ]] || { echo "Neispravan raspon pasivnih portova: $PASSIVE"; exit 1; }
PASV_START=${BASH_REMATCH[1]}; PASV_END=${BASH_REMATCH[2]}
[[ -d $APP_ROOT/servers ]] || { echo "Game Panel nije pronađen u $APP_ROOT"; exit 1; }
# the ports must be free (or already ours)
if [[ -z "$(docker ps -q -f name=^$NAME$)" ]]; then
  for p in "$FTP_PORT" "$SFTP_PORT"; do
    if ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; then
      echo "Port $p je zauzet. Odaberi drugi: FTP_PORT=2121 SFTP_PORT=2222 bash $0"; exit 1
    fi
  done
fi

DOMAIN="$(grep -E '^DOMAIN=' "$APP_ROOT/deploy/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")"
[[ -n $DOMAIN ]] || { echo "DOMAIN nije pronađen u $APP_ROOT/deploy/.env"; exit 1; }
# passive FTP: the address clients open the data connection to (inside Docker the server only knows its own)
IP="${FTP_PUBLIC_IP:-}"
[[ -n $IP ]] || IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
[[ -n $IP ]] || IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
[[ $IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Javna IP adresa nije pronađena: FTP_PUBLIC_IP=1.2.3.4 bash $0"; exit 1; }

# the panel's network (Traefik's): the backend reaches the FTP service's API there; Let's Encrypt for FTPS
traefik="$(docker ps -q --filter label=com.docker.compose.project=gamepanel --filter label=com.docker.compose.service=traefik | head -1)"
[[ -n $traefik ]] || { echo "Traefik panela ne radi (docker ps). Pokreni panel pa ponovno."; exit 1; }
EDGE="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$traefik" | awk '{print $1}')"
le="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/letsencrypt"}}{{.Source}}{{end}}{{end}}' "$traefik")"
ACME=""; [[ -n $le ]] && ACME="$le/acme.json"

# the panel's backend: the FTP service reports every upload, download, delete ... to it (Admin > FTP > Activity)
backend="$(docker ps --format '{{.Names}}' --filter label=com.docker.compose.project=gamepanel --filter label=com.docker.compose.service=backend | head -1)"
API_PORT="$(grep -E '^PORT=' "$APP_ROOT/deploy/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")"
[[ -n $backend && $API_PORT =~ ^[0-9]+$ ]] || { echo "Backend panela ne radi ili PORT nije u $APP_ROOT/deploy/.env. Pokreni panel pa ponovno."; exit 1; }

mkdir -p "$ETC/data" "$ETC/certs" "$STATE"
chmod 700 "$ETC"
# the panel's admin login to the FTP service: made once, kept
[[ -s $ETC/admin.pass ]] || { python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))" > "$ETC/admin.pass"; }
chmod 600 "$ETC/admin.pass"
ADMIN_PASS="$(cat "$ETC/admin.pass")"
[[ -s $ETC/hook.key ]] || { python3 -c "import secrets; print(secrets.token_hex(24))" > "$ETC/hook.key"; }
chmod 600 "$ETC/hook.key"
HOOK_KEY="$(cat "$ETC/hook.key")"

# ---- 1) FTPS certificate: the panel's one from Traefik, renewed with it --------------------------------------------
cat > "$ETC/cert.py" <<'PY'
#!/usr/bin/env python3
"""Copies the panel's Let's Encrypt certificate (Traefik's acme.json) for FTPS and tells SFTPGo to reload it."""
import base64, json, os, subprocess, sys
acme, domain, certs, container = sys.argv[1:5]
try:
    data = json.load(open(acme))
except Exception:
    sys.exit(0)
for resolver in data.values():
    for item in (resolver or {}).get('Certificates') or []:
        names = [item.get('domain', {}).get('main', '')] + list(item.get('domain', {}).get('sans') or [])
        if domain not in names:
            continue
        cert, key = base64.b64decode(item['certificate']), base64.b64decode(item['key'])
        crt, kf = os.path.join(certs, 'ftp.crt'), os.path.join(certs, 'ftp.key')
        try:
            if open(crt, 'rb').read() == cert:
                sys.exit(0)
        except FileNotFoundError:
            pass
        for path, content, mode in ((kf, key, 0o600), (crt, cert, 0o644)):
            with open(path + '.tmp', 'wb') as f:
                f.write(content)
            os.chmod(path + '.tmp', mode)
            os.replace(path + '.tmp', path)
        subprocess.run(['docker', 'kill', '-s', 'HUP', container], capture_output=True)
        print('ftp: certificate for %s updated' % domain)
        sys.exit(0)
PY
if [[ -n $ACME ]]; then python3 "$ETC/cert.py" "$ACME" "$DOMAIN" "$ETC/certs" $NAME || true; fi
if [[ ! -s $ETC/certs/ftp.crt ]]; then
  command -v openssl >/dev/null || { apt-get update -qq && apt-get install -y -qq openssl; }
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=$DOMAIN" \
    -keyout "$ETC/certs/ftp.key" -out "$ETC/certs/ftp.crt" >/dev/null 2>&1
  echo "== Certifikat iz Traefika nije pronađen, privremeno vlastiti (zamijeni se sam kad se pojavi)"
fi
if [[ -n $ACME ]]; then
  cat > /etc/systemd/system/$CERT_UNIT.service <<UNIT
[Unit]
Description=Game Panel FTP: FTPS certificate from the panel
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $ETC/cert.py $ACME $DOMAIN $ETC/certs $NAME
UNIT
  cat > /etc/systemd/system/$CERT_UNIT.timer <<UNIT
[Unit]
Description=Game Panel FTP: check the FTPS certificate
[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
[Install]
WantedBy=timers.target
UNIT
  $SYSTEMCTL daemon-reload && $SYSTEMCTL enable --now $CERT_UNIT.timer >/dev/null 2>&1 || true
fi

# ---- 2) the FTP service ----------------------------------------------------------------------------------------
docker image inspect $IMAGE >/dev/null 2>&1 || { echo "== Preuzimam $IMAGE"; docker pull -q $IMAGE >/dev/null; }
docker rm -f $NAME >/dev/null 2>&1 || true
# root inside, so it can write everywhere in the servers' folders; files get the game server's user (uid 1000)
docker run -d --name $NAME --restart unless-stopped --user 0:0 \
  -p "$FTP_PORT:21" -p "$SFTP_PORT:2022" -p "$PASV_START-$PASV_END:$PASV_START-$PASV_END" \
  -v "$APP_ROOT/servers:/srv/servers" -v "$ETC/data:/var/lib/sftpgo" -v "$ETC/certs:/certs:ro" \
  -e SFTPGO_DATA_PROVIDER__CREATE_DEFAULT_ADMIN=true \
  -e SFTPGO_DEFAULT_ADMIN_USERNAME=panel -e "SFTPGO_DEFAULT_ADMIN_PASSWORD=$ADMIN_PASS" \
  -e SFTPGO_FTPD__BINDINGS__0__PORT=21 -e SFTPGO_FTPD__BINDINGS__0__TLS_MODE=0 \
  -e "SFTPGO_FTPD__BINDINGS__0__FORCE_PASSIVE_IP=$IP" \
  -e "SFTPGO_FTPD__PASSIVE_PORT_RANGE__START=$PASV_START" -e "SFTPGO_FTPD__PASSIVE_PORT_RANGE__END=$PASV_END" \
  -e SFTPGO_FTPD__CERTIFICATE_FILE=/certs/ftp.crt -e SFTPGO_FTPD__CERTIFICATE_KEY_FILE=/certs/ftp.key \
  -e SFTPGO_FTPD__BANNER="Game Panel FTP" \
  -e SFTPGO_SFTPD__BINDINGS__0__PORT=2022 \
  -e SFTPGO_HTTPD__BINDINGS__0__PORT=8080 \
  -e SFTPGO_HTTPD__BINDINGS__0__ENABLE_WEB_ADMIN=false -e SFTPGO_HTTPD__BINDINGS__0__ENABLE_WEB_CLIENT=false \
  -e SFTPGO_COMMON__DEFENDER__ENABLED=true \
  -e SFTPGO_COMMON__ACTIONS__EXECUTE_ON=upload,download,delete,rename,mkdir,rmdir \
  -e "SFTPGO_COMMON__ACTIONS__HOOK=http://$backend:$API_PORT/api/ftp/events?key=$HOOK_KEY" \
  $IMAGE >/dev/null
docker network connect "$EDGE" $NAME
ok=""
for _ in $(seq 1 30); do
  if docker exec $NAME sftpgo ping >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ -n $ok ]] || { echo "FTP servis se nije pokrenuo:"; docker logs --tail 30 $NAME; exit 1; }

# the panel reads this (Settings > Game config > FTP access, Admin > FTP); only the panel's backend can read it
umask 077
cat > "$STATE/ftp.json" <<JSON
{"api": "http://$NAME:8080", "admin": "panel", "password": "$ADMIN_PASS", "host": "$DOMAIN", "ftpPort": $FTP_PORT, "sftpPort": $SFTP_PORT, "serversDir": "/srv/servers", "hookKey": "$HOOK_KEY"}
JSON
umask 022

# a firewall on the server (ufw): open the ports
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$FTP_PORT/tcp" >/dev/null; ufw allow "$SFTP_PORT/tcp" >/dev/null; ufw allow "$PASV_START:$PASV_END/tcp" >/dev/null
  echo "== ufw: otvoreni portovi $FTP_PORT, $SFTP_PORT i $PASV_START-$PASV_END"
fi

echo
echo "== FTP je spreman"
echo "   FTP / FTPS: $DOMAIN port $FTP_PORT (pasivni portovi $PASV_START-$PASV_END)"
echo "   SFTP:       $DOMAIN port $SFTP_PORT"
echo "Račun za server otvoriš u panelu: postavke servera > Game config > FTP access (ili Admin > FTP)."
echo "Ako server ima vatrozid kod OVH-a (Network firewall), otvori i tamo te portove."
