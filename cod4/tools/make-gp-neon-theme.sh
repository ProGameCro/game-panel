#!/bin/bash
# builds gp-neon-theme.sh with all files embedded
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; GEN="$ROOT/cod4/tools/patches"; OUT="$ROOT/cod4/install/gp-neon-theme.sh"
b(){ base64 -w0 "$1"; }
cat > "$OUT" <<EOF
#!/usr/bin/env bash
# OVHcloud Game Panel: "Neon" theme, an animated theme on top of the dark theme.
# Turn it on with the ✨ button next to the light/dark button at the bottom of the sidebar.
# Safe to run again (also after a panel update, which removes it).
set -euo pipefail
APP_ROOT="\${GP_APP_ROOT:-/opt/gamepanel}"
cd /
F="\$APP_ROOT/app/frontend"
DEPLOY="\$APP_ROOT/deploy"
[[ \$EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash \$0"; exit 1; }
[[ -f \$F/main.tsx && -f \$DEPLOY/compose.yml ]] || { echo "Game Panel nije pronađen u \$APP_ROOT"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
backup="\$(mktemp -d)"
cp -p "\$F/main.tsx" "\$F/contexts/ThemeContext.tsx" "\$F/components/Sidebar.tsx" "\$backup/"
had=0; [[ -f \$F/src/ui/theme/neon.css ]] && { cp -p "\$F/src/ui/theme/neon.css" "\$backup/"; had=1; }
restore(){
  cp -p "\$backup/main.tsx" "\$F/"; cp -p "\$backup/ThemeContext.tsx" "\$F/contexts/"; cp -p "\$backup/Sidebar.tsx" "\$F/components/"
  if ((had)); then cp -p "\$backup/neon.css" "\$F/src/ui/theme/"; else rm -f "\$F/src/ui/theme/neon.css"; fi
  echo "Greška: izmjena vraćena." >&2
}
trap 'rc=\$?; ((rc)) && restore' EXIT
echo '$(b $ROOT/frontend/src/ui/theme/neon.css)' | base64 -d > "\$F/src/ui/theme/neon.css"
echo '$(b $ROOT/frontend/contexts/ThemeContext.tsx)' | base64 -d > "\$F/contexts/ThemeContext.tsx"
echo '$(b $GEN/patch_neon_sidebar.py)' | base64 -d | python3 - "\$F/components/Sidebar.tsx"
echo '$(b $GEN/patch_neon_main.py)' | base64 -d | python3 - "\$F/main.tsx"
changed=0
for f in main.tsx:\$F/main.tsx ThemeContext.tsx:\$F/contexts/ThemeContext.tsx Sidebar.tsx:\$F/components/Sidebar.tsx; do cmp -s "\$backup/\${f%%:*}" "\${f#*:}" || changed=1; done
((had)) && cmp -s "\$backup/neon.css" "\$F/src/ui/theme/neon.css" || changed=1
if ((changed)); then
  echo "Gradim sučelje panela s Neon temom (par minuta)..."
  docker compose --project-name gamepanel --env-file "\$DEPLOY/.env" -f "\$DEPLOY/compose.yml" build frontend
  docker compose --project-name gamepanel --env-file "\$DEPLOY/.env" -f "\$DEPLOY/compose.yml" up -d frontend
else
  echo "Neon tema je već instalirana."
fi
trap - EXIT
rm -rf "\$backup"
echo "Gotovo. Panel: Ctrl+Shift+R, pa dolje u bočnom izborniku gumb ✨ (pored sunca/mjeseca) uključuje Neon temu."
echo "Nakon nadogradnje Game Panela ponovno pokreni: sudo bash \$0"
EOF
bash -n "$OUT" && ls -la "$OUT"
