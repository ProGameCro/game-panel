#!/bin/bash
# builds gp-b3.sh with all files embedded
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; P="$ROOT/cod4/b3"; F="$ROOT/frontend/components"; GEN="$ROOT/cod4/tools/patches"
b(){ base64 -w0 "$1"; }
OUT="$ROOT/cod4/install/gp-b3.sh"
BUILD=$(cat $P/Dockerfile $P/entrypoint.sh $P/big-brother-bot-master.zip $P/b3-complete-ebc.sql $P/cod4x18.py | sha256sum | cut -c1-16)
cat > $OUT <<EOF
#!/usr/bin/env bash
# OVHcloud Game Panel: B3 (BigBrotherBot) for Call of Duty 4 servers.
# - card "B3 (BigBrotherBot)" in Server settings > Game config (install, start / stop / restart, console, settings)
# - Docker image with your B3 (big-brother-bot-master.zip: B3 1.12 + cod4x parser, Python 2.7), nothing downloaded; configs, parsers, plugins or a whole B3 go to the server folder b3/
# - new databases get the complete schema b3-complete-ebc.sql; Install B3 writes a ready b3.ini (parser cod4x)
# - service gamepanel-b3 (systemd) that runs one B3 container per server when you press Start in the panel
# - MariaDB container for B3's database (one database per server)
# Needs the CoD4 Command line card (gp-cod4-cmdline.sh). Safe to run again (also after a panel update).
set -euo pipefail
APP_ROOT="\${GP_APP_ROOT:-/opt/gamepanel}"
# the current folder may have been deleted (docker compose then fails), so work from /
cd /
SRC="\$APP_ROOT/app"
DEPLOY="\$APP_ROOT/deploy"
C="\$SRC/frontend/components"
IMAGE=gamepanel-b3:1.12
DB_IMAGE=mariadb:11.4
ETC=/etc/gamepanel-b3
LIB=/usr/local/lib/gamepanel-b3
[[ \$EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash \$0"; exit 1; }
[[ -d \$SRC/frontend && -f \$DEPLOY/compose.yml ]] || { echo "Game Panel nije pronađen u \$APP_ROOT"; exit 1; }
if ! grep -q "lives only in the command line" "\$C/serverSettings/Cod4ModSection.tsx" 2>/dev/null; then
  echo "Prvo instaliraj CoD4 Command line karticu: sudo bash gp-cod4-cmdline.sh (pa onda ponovno ovu skriptu)."; exit 1
fi
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
mkdir -p "\$ETC" "\$LIB" "\$APP_ROOT/b3-image"
chmod 700 "\$ETC"

echo "== 1) B3 Docker image"
BUILD=$BUILD
have="\$(docker image inspect -f '{{index .Config.Labels "org.gamepanel.b3.build"}}' \$IMAGE 2>/dev/null || true)"
if [[ "\$have" != "\$BUILD" || "\${GP_B3_REBUILD:-}" == 1 ]]; then
  cd "\$APP_ROOT/b3-image"
  echo '$(b $P/Dockerfile)' | base64 -d > Dockerfile
  echo '$(b $P/entrypoint.sh)' | base64 -d > entrypoint.sh
  # your B3 (big-brother-bot-master.zip: B3 1.12 + cod4x parser), built as it is
  echo '$(b $P/big-brother-bot-master.zip)' | base64 -d > b3.zip
  echo '$(b $P/unzip_b3.py)' | base64 -d > unzip_b3.py
  python3 -I unzip_b3.py b3.zip b3src
  echo '$(b $P/b3-complete-ebc.sql)' | base64 -d > b3-complete-ebc.sql
  echo '$(b $P/cod4x18.py)' | base64 -d > cod4x18.py
  docker build -q --label org.gamepanel.b3.build=\$BUILD -t \$IMAGE . >/dev/null
  rm -rf b3.zip b3src
  echo "   izgrađen \$IMAGE (B3 koji već radi koristi novi image nakon Restart u panelu)"
else
  echo "   \$IMAGE je aktualan"
fi

echo "== 2) Baza (MariaDB)"
if [[ ! -f \$ETC/db.env ]]; then
  port=3306
  if (exec 3<>/dev/tcp/127.0.0.1/3306) 2>/dev/null; then port=3307; fi
  gen(){ tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24; }
  printf 'B3_DB_ROOT_PASSWORD=%s\nB3_DB_PASSWORD=%s\nB3_DB_PORT=%s\n' "\$(gen)" "\$(gen)" "\$port" > \$ETC/db.env
  chmod 600 \$ETC/db.env
fi
set -a; . \$ETC/db.env; set +a
if [[ -z "\$(docker ps -aq -f name=^gamepanel-b3-db\$)" ]]; then
  docker run -d --name gamepanel-b3-db --restart unless-stopped -p 127.0.0.1:\$B3_DB_PORT:3306 \\
    -e MARIADB_ROOT_PASSWORD="\$B3_DB_ROOT_PASSWORD" -e MARIADB_USER=b3 -e MARIADB_PASSWORD="\$B3_DB_PASSWORD" \\
    -v gamepanel-b3-db:/var/lib/mysql \$DB_IMAGE >/dev/null
fi
docker start gamepanel-b3-db >/dev/null
for i in \$(seq 1 60); do docker exec -e MYSQL_PWD="\$B3_DB_ROOT_PASSWORD" gamepanel-b3-db mariadb -uroot -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
docker exec -e MYSQL_PWD="\$B3_DB_ROOT_PASSWORD" gamepanel-b3-db mariadb -uroot -e 'select 1' >/dev/null || { echo "MariaDB se ne pokreće (docker logs gamepanel-b3-db)"; exit 1; }
echo "   MariaDB radi na 127.0.0.1:\$B3_DB_PORT"

echo "== 3) Servis gamepanel-b3"
echo '$(b $P/gp-b3d.py)' | base64 -d > \$LIB/gp-b3d.py
echo '$(b $P/b3-complete-ebc.sql)' | base64 -d > \$LIB/b3-complete-ebc.sql
chmod 755 \$LIB/gp-b3d.py
cat > /etc/systemd/system/gamepanel-b3.service <<UNIT
[Unit]
Description=B3 (BigBrotherBot) for the OVHcloud Game Panel
After=docker.service
Requires=docker.service

[Service]
Environment=GP_SERVERS_DIR=\$APP_ROOT/servers
Environment=GP_B3_IMAGE=\$IMAGE
ExecStart=/usr/bin/python3 \$LIB/gp-b3d.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable gamepanel-b3 >/dev/null 2>&1
systemctl restart gamepanel-b3
echo "   gamepanel-b3: \$(systemctl is-active gamepanel-b3)"

echo "== 4) Kartica B3 u panelu"
backup="\$APP_ROOT/b3-backup-\$(date +%Y%m%d-%H%M%S)"; mkdir -p "\$backup"
cp -p "\$C/GameConfigTab.tsx" "\$C/ServerSettingsModal.tsx" "\$C/serverSettings/Cod4ModSection.tsx" "\$backup/"
had_b3=0; [[ -f \$C/serverSettings/B3Section.tsx ]] && { cp -p "\$C/serverSettings/B3Section.tsx" "\$backup/"; had_b3=1; }
restore(){
  cp -p "\$backup/GameConfigTab.tsx" "\$backup/ServerSettingsModal.tsx" "\$C/"; cp -p "\$backup/Cod4ModSection.tsx" "\$C/serverSettings/"
  if ((had_b3)); then cp -p "\$backup/B3Section.tsx" "\$C/serverSettings/"; else rm -f "\$C/serverSettings/B3Section.tsx"; fi
  echo "Greška: izmjena panela vraćena (kopija u \$backup)." >&2
}
trap 'rc=\$?; ((rc)) && restore' EXIT
echo '$(b $F/serverSettings/Cod4ModSection.tsx)' | base64 -d > "\$C/serverSettings/Cod4ModSection.tsx"
echo '$(b $F/serverSettings/B3Section.tsx)' | base64 -d > "\$C/serverSettings/B3Section.tsx"
# FTP access card (gp-ftp.sh), shown under the Command line card
echo '$(b $F/serverSettings/FtpSection.tsx)' | base64 -d > "\$C/serverSettings/FtpSection.tsx"
echo '$(b $F/serverSettings/Cod4ReinstallSection.tsx)' | base64 -d > "\$C/serverSettings/Cod4ReinstallSection.tsx"
echo '$(b $GEN/patch_tab.py)' | base64 -d | python3 - "\$C/GameConfigTab.tsx"
echo '$(b $GEN/patch_modal.py)' | base64 -d | python3 - "\$C/ServerSettingsModal.tsx"
dc(){ docker compose --project-name gamepanel --env-file "\$DEPLOY/.env" -f "\$DEPLOY/compose.yml" "\$@"; }
if cmp -s "\$backup/GameConfigTab.tsx" "\$C/GameConfigTab.tsx" && cmp -s "\$backup/ServerSettingsModal.tsx" "\$C/ServerSettingsModal.tsx" && cmp -s "\$backup/Cod4ModSection.tsx" "\$C/serverSettings/Cod4ModSection.tsx" && ((had_b3)) && cmp -s "\$backup/B3Section.tsx" "\$C/serverSettings/B3Section.tsx"; then
  echo "   kartica je već instalirana"
else
  echo "   gradim novo sučelje panela (par minuta)..."
  dc build frontend
  dc up -d frontend
fi
trap - EXIT
echo
echo "Gotovo. Panel (Ctrl+F5) > CoD4 server > Settings > Game config > kartica 'B3 (BigBrotherBot)' > Install B3 > Start B3."
echo "Install B3 sam napravi b3/conf/b3.ini (parser cod4x, RCON, game_log, baza)."
echo "Po želji preko File managera dodaj svoje configove u b3/conf, parsere u b3/parsers, pluginove u b3/extplugins"
echo "(ili cijeli svoj B3, folder s b3_run.py, u b3/app) pa stisni Restart."
echo "Baza za B3: mysql://b3:\$B3_DB_PASSWORD@127.0.0.1\$( [[ \$B3_DB_PORT == 3306 ]] || echo :\$B3_DB_PORT )/b3_<server> (točan naziv piše u kartici)."
echo "Nakon nadogradnje Game Panela ponovno pokreni: sudo bash \$0"
EOF
bash -n $OUT && ls -la $OUT
