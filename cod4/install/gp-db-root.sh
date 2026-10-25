#!/usr/bin/env bash
# Checks the MariaDB root login of gamepanel-b3-db (used by phpMyAdmin) and, when it does not work,
# resets root (root@localhost and root@'%') to the password stored in /etc/gamepanel-b3/db.env.
# B3's data and the b3 user are not touched. Usage: sudo bash gp-db-root.sh [new-password]
set -euo pipefail
ETC=/etc/gamepanel-b3
DB=gamepanel-b3-db
NET=gamepanel-b3-net
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
[[ -f $ETC/db.env && -n "$(docker ps -aq -f name=^$DB$)" ]] || { echo "Baza nije instalirana (sudo bash gp-b3.sh)"; exit 1; }
set -a; . $ETC/db.env; set +a
IMAGE="$(docker inspect -f '{{.Config.Image}}' $DB)"

if [[ -n ${1:-} ]]; then
  [[ $1 =~ ^[A-Za-z0-9._@%+=-]{8,64}$ ]] || { echo "Lozinka: 8-64 znaka, slova, brojevi i . _ @ % + = -"; exit 1; }
  sed -i "s/^B3_DB_ROOT_PASSWORD=.*/B3_DB_ROOT_PASSWORD=$1/" $ETC/db.env
  B3_DB_ROOT_PASSWORD="$1"
  force=1
else
  force=0
fi
docker start $DB >/dev/null
docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
docker network connect $NET $DB 2>/dev/null || true

# the login exactly as phpMyAdmin does it: over the network, as root@'%'
net_login(){ docker run --rm --network $NET -e MYSQL_PWD="$B3_DB_ROOT_PASSWORD" "$IMAGE" mariadb -h $DB -uroot -e 'select 1' >/dev/null 2>&1; }
for i in $(seq 1 30); do docker exec $DB mariadb-admin ping --silent >/dev/null 2>&1 && break; sleep 1; done

if ((force == 0)) && net_login; then
  echo "Root prijava radi. U phpMyAdminu: korisnik root, lozinka $B3_DB_ROOT_PASSWORD"
  exit 0
fi

echo "== Postavljam root lozinku (baza se zaustavi na desetak sekundi, B3 se nakon toga sam spoji)"
SQL="FLUSH PRIVILEGES;
ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY '$B3_DB_ROOT_PASSWORD';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '$B3_DB_ROOT_PASSWORD';
ALTER USER 'root'@'%' IDENTIFIED BY '$B3_DB_ROOT_PASSWORD';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;"
# the data volume (named volume or host folder) of the database container
VOL="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' $DB)"
[[ -n $VOL ]] || { echo "Ne nalazim podatke baze ($DB nema /var/lib/mysql)"; exit 1; }
tmp=gamepanel-b3-db-reset
trap 'docker rm -f $tmp >/dev/null 2>&1; docker start $DB >/dev/null' EXIT
docker stop $DB >/dev/null
docker rm -f $tmp >/dev/null 2>&1 || true
docker run -d --name $tmp -v "$VOL":/var/lib/mysql "$IMAGE" --skip-grant-tables --skip-networking >/dev/null
for i in $(seq 1 60); do docker exec $tmp mariadb -uroot -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
docker exec $tmp mariadb -uroot -e "$SQL"
# clean shutdown (SIGTERM) so the new password is safely written
docker stop -t 60 $tmp >/dev/null
docker rm -f $tmp >/dev/null
docker start $DB >/dev/null
trap - EXIT
for i in $(seq 1 30); do net_login && break; sleep 1; done
if net_login; then
  echo "Gotovo. U phpMyAdminu: korisnik root, lozinka $B3_DB_ROOT_PASSWORD"
else
  echo "Root prijava i dalje ne radi. Pošalji: docker logs --tail 50 $DB"; exit 1
fi
