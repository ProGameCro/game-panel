#!/usr/bin/env bash
# phpMyAdmin for the B3 database (MariaDB container gamepanel-b3-db from gp-b3.sh).
# Served by the panel's Traefik at https://<panel domain>/pma/ with HTTPS, behind an extra password (Traefik basic auth),
# then the phpMyAdmin login (user b3 or root). No new domain or DNS record is needed. Safe to run again.
set -euo pipefail
APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
ENVF="$APP_ROOT/deploy/.env"
ETC=/etc/gamepanel-b3
IMAGE=phpmyadmin:5.2
NET=gamepanel-b3-net
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
[[ -f $ENVF ]] || { echo "Game Panel nije pronađen u $APP_ROOT"; exit 1; }
[[ -f $ETC/db.env && -n "$(docker ps -aq -f name=^gamepanel-b3-db$)" ]] || { echo "Prvo instaliraj B3 i bazu: sudo bash gp-b3.sh"; exit 1; }
command -v openssl >/dev/null || { apt-get update -qq && apt-get install -y -qq openssl; }

DOMAIN="$(grep -E '^DOMAIN=' "$ENVF" | tail -1 | cut -d= -f2- | tr -d "\"'")"
[[ -n $DOMAIN ]] || { echo "DOMAIN nije postavljen u $ENVF"; exit 1; }
traefik="$(docker ps -q --filter label=com.docker.compose.project=gamepanel --filter label=com.docker.compose.service=traefik | head -1)"
[[ -n $traefik ]] || { echo "Traefik panela ne radi (docker compose ... up -d)"; exit 1; }
EDGE="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$traefik" | awk '{print $1}')"
echo "== Panel: $DOMAIN (Traefik mreža: $EDGE)"

# private network between phpMyAdmin and MariaDB (MariaDB itself stays reachable only on 127.0.0.1 of the host)
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
docker network connect "$NET" gamepanel-b3-db 2>/dev/null || true

if [[ ! -f $ETC/pma.env ]]; then
  pw="$(openssl rand -hex 10)"
  printf "PMA_WEB_USER=admin\nPMA_WEB_PASSWORD=%s\nPMA_WEB_HASH='%s'\n" "$pw" "$(openssl passwd -apr1 "$pw")" > $ETC/pma.env
  chmod 600 $ETC/pma.env
fi
set -a; . $ETC/pma.env; . $ETC/db.env; set +a

docker rm -f gamepanel-pma >/dev/null 2>&1 || true
docker run -d --name gamepanel-pma --restart unless-stopped --network "$NET" \
  -e PMA_HOST=gamepanel-b3-db -e PMA_ABSOLUTE_URI="https://$DOMAIN/pma/" -e UPLOAD_LIMIT=512M \
  --label traefik.enable=true \
  --label "traefik.http.routers.gamepanel_pma.rule=Host(\`$DOMAIN\`) && PathPrefix(\`/pma\`)" \
  --label traefik.http.routers.gamepanel_pma.entrypoints=websecure \
  --label traefik.http.routers.gamepanel_pma.tls=true \
  --label traefik.http.routers.gamepanel_pma.tls.certresolver=le \
  --label traefik.http.routers.gamepanel_pma.middlewares=gamepanel_pma_slash,gamepanel_pma_auth,gamepanel_pma_strip \
  --label 'traefik.http.middlewares.gamepanel_pma_slash.redirectregex.regex=^(https?://[^/]+/pma)$' \
  --label 'traefik.http.middlewares.gamepanel_pma_slash.redirectregex.replacement=${1}/' \
  --label "traefik.http.middlewares.gamepanel_pma_auth.basicauth.users=$PMA_WEB_USER:$PMA_WEB_HASH" \
  --label traefik.http.middlewares.gamepanel_pma_strip.stripprefix.prefixes=/pma \
  --label traefik.http.services.gamepanel_pma.loadbalancer.server.port=80 \
  "$IMAGE" >/dev/null
docker network connect "$EDGE" gamepanel-pma

echo "== Provjera"
ok=0
for i in $(seq 1 30); do
  code="$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" -u "$PMA_WEB_USER:$PMA_WEB_PASSWORD" "https://$DOMAIN/pma/" || true)"
  [[ $code == 200 ]] && { ok=1; break; }
  sleep 2
done
((ok)) && echo "   phpMyAdmin odgovara" || echo "   phpMyAdmin još ne odgovara (zadnji kod: $code). Provjeri: docker logs gamepanel-pma"
echo
echo "Otvori: https://$DOMAIN/pma/"
echo "1) prozor preglednika:  korisnik $PMA_WEB_USER   lozinka $PMA_WEB_PASSWORD"
echo "2) phpMyAdmin prijava:  korisnik b3   lozinka $B3_DB_PASSWORD   (baze b3_<server>)"
echo "   (za sve baze: korisnik root   lozinka $B3_DB_ROOT_PASSWORD)"
echo "Lozinke su spremljene u $ETC/pma.env i $ETC/db.env."
