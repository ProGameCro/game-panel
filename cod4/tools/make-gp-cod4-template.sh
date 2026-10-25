#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; A="$ROOT/backend/src/providers/linuxgsm/adapters"; GEN="$ROOT/cod4/tools/patches"
b(){ base64 -w0 "$1"; }
OUT="$ROOT/cod4/install/gp-cod4-template.sh"
cat > $OUT <<EOF
#!/usr/bin/env bash
# OVHcloud Game Panel: new Call of Duty 4 servers start from a copy of one of your CoD4 servers instead of downloading,
# new CoD4 servers skip the LinuxGSM update check on GitHub at every start (UPDATE_ON_START=false),
# and the CoD4 install form gets a Slots field (players, sv_maxclients).
#   sudo bash gp-cod4-template.sh            list your CoD4 servers
#   sudo bash gp-cod4-template.sh 12         make the template from server 12 (folder /opt/gamepanel/servers/12)
#   sudo bash gp-cod4-template.sh --remove   delete the template (new servers download again)
# The template is the server's serverfiles folder (CoD4X, main, mods, usermaps, server.cfg ...), without log files.
# The first run also adds the CoD4 step to the panel backend. Run again after a panel update.
set -euo pipefail
APP_ROOT="\${GP_APP_ROOT:-/opt/gamepanel}"
# the current folder may have been deleted (docker compose then fails), so work from /
cd /
SRC="\$APP_ROOT/app"
DEPLOY="\$APP_ROOT/deploy"
AD="\$SRC/backend/src/providers/linuxgsm/adapters"
SPEC="\$SRC/backend/src/providers/linuxgsm/installSpec.ts"
TPL="\$APP_ROOT/data/templates/cod4/serverfiles"
[[ \$EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash \$0"; exit 1; }
[[ -f \$AD/registry.ts && -f \$DEPLOY/compose.yml ]] || { echo "Game Panel nije pronađen u \$APP_ROOT"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
dc(){ docker compose --project-name gamepanel --env-file "\$DEPLOY/.env" -f "\$DEPLOY/compose.yml" "\$@"; }

# ---- 1) CoD4 changes in the panel (backend: template, slots, no update on start; install form: Slots) -----------
FORM="\$SRC/frontend/components/InstallGameServer.tsx"
TYPES="\$AD/types.ts"
SERVERS="\$SRC/backend/src/services/servers.ts"
backup="\$(mktemp -d)"
cp -p "\$AD/registry.ts" "\$SPEC" "\$TYPES" "\$SERVERS" "\$FORM" "\$backup/"
had=0; [[ -f \$AD/cod4/index.ts ]] && { cp -p "\$AD/cod4/index.ts" "\$backup/"; had=1; }
restore(){
  cp -p "\$backup/registry.ts" "\$backup/types.ts" "\$AD/"; cp -p "\$backup/installSpec.ts" "\$SPEC"
  cp -p "\$backup/servers.ts" "\$SERVERS"; cp -p "\$backup/InstallGameServer.tsx" "\$FORM"
  if ((had)); then cp -p "\$backup/index.ts" "\$AD/cod4/"; else rm -rf "\$AD/cod4"; fi
  echo "Greška: izmjena panela vraćena." >&2
}
trap 'rc=\$?; ((rc)) && restore' EXIT
mkdir -p "\$AD/cod4"
echo '$(b $A/cod4/index.ts)' | base64 -d > "\$AD/cod4/index.ts"
echo '$(b $GEN/patch_registry.py)' | base64 -d | python3 - "\$AD/registry.ts"
# new CoD4 servers: no LinuxGSM update check on GitHub at every start (UPDATE_ON_START=false)
echo '$(b $GEN/patch_installspec.py)' | base64 -d | python3 - "\$SPEC"
# the install form's Slots reach the CoD4 step as COD4_MAXPLAYERS
echo '$(b $GEN/patch_backend_env.py)' | base64 -d | python3 - "\$TYPES" "\$SERVERS"
echo '$(b $GEN/patch_install_form.py)' | base64 -d | python3 - "\$FORM"
backend_changed=0; frontend_changed=0
for f in registry.ts:\$AD/registry.ts installSpec.ts:\$SPEC types.ts:\$TYPES servers.ts:\$SERVERS; do
  cmp -s "\$backup/\${f%%:*}" "\${f#*:}" || backend_changed=1
done
((had)) && cmp -s "\$backup/index.ts" "\$AD/cod4/index.ts" || backend_changed=1
cmp -s "\$backup/InstallGameServer.tsx" "\$FORM" || frontend_changed=1
if ((backend_changed)); then
  echo "== Dopunjujem backend panela (par minuta)..."
  dc build backend
  dc up -d backend
fi
if ((frontend_changed)); then
  echo "== Dodajem Slots u instalaciju CoD4 (gradim sučelje panela, par minuta)..."
  dc build frontend
  dc up -d frontend
fi
((backend_changed || frontend_changed)) || echo "== Panel već ima sve CoD4 izmjene"
trap - EXIT
rm -rf "\$backup"

# ---- 2) the template ---------------------------------------------------------------------------------------------
cod4_servers(){ for d in "\$APP_ROOT"/servers/*/data; do [[ -d \$d/config-lgsm/cod4server && -d \$d/serverfiles ]] && basename "\$(dirname "\$d")"; done; }
case "\${1:-}" in
  "")
    echo
    echo "Tvoji CoD4 serveri:"
    found=0
    for k in \$(cod4_servers); do
      found=1
      d="\$APP_ROOT/servers/\$k/data/serverfiles"
      name="\$(grep -hoE 'sv_hostname +"[^"]*"' "\$d"/main/*.cfg "\$d"/mods/*/*.cfg 2>/dev/null | head -1 | sed 's/sv_hostname *//' || true)"
      printf '  %-6s %-8s %s\n' "\$k" "\$(du -sh "\$d" 2>/dev/null | cut -f1)" "\${name:-}"
    done
    ((found)) || echo "  (nema)"
    if [[ -d \$TPL ]]; then echo; echo "Trenutni predložak: \$(du -sh "\$TPL" | cut -f1) (\$(cat "\$TPL/../source.txt" 2>/dev/null || echo ?))"; fi
    echo
    echo "Napravi predložak:  sudo bash \$0 <broj servera>"
    ;;
  --remove)
    rm -rf "\$APP_ROOT/data/templates/cod4"
    echo "Predložak obrisan. Novi CoD4 serveri ponovno skidaju datoteke."
    ;;
  *)
    k="\$1"
    [[ \$k =~ ^[A-Za-z0-9_-]+\$ ]] || { echo "Neispravan broj servera: \$k"; exit 1; }
    src="\$APP_ROOT/servers/\$k/data/serverfiles"
    [[ -d \$src && -d \$APP_ROOT/servers/\$k/data/config-lgsm/cod4server ]] || { echo "Server \$k nije CoD4 server (nema \$src)"; exit 1; }
    [[ -n "\$(ls -A "\$src")" ]] || { echo "Server \$k još nema datoteke (instalacija nije gotova)"; exit 1; }
    echo "== Kopiram serverfiles servera \$k (\$(du -sh "\$src" | cut -f1)) ..."
    tmp="\$APP_ROOT/data/templates/cod4/serverfiles.new"
    rm -rf "\$tmp"; mkdir -p "\$tmp"
    cp -a "\$src/." "\$tmp/"
    # log files belong to the source server only
    find "\$tmp" -type f \( -name '*.log' -o -name 'games_mp.log*' \) -delete
    chmod -R a+rX "\$tmp"
    rm -rf "\$TPL"; mv "\$tmp" "\$TPL"
    echo "server \$k, \$(date '+%F %T')" > "\$TPL/../source.txt"
    echo
    echo "Gotovo. Predložak: \$(du -sh "\$TPL" | cut -f1)."
    echo "Svaki novi CoD4 server koji instaliraš u panelu dobije ove datoteke odmah, bez skidanja."
    echo "Kad promijeniš modove ili mape na serveru \$k, pokreni ovo ponovno da osvježiš predložak."
    ;;
esac
EOF
bash -n $OUT && ls -la $OUT
