#!/usr/bin/env python3
"""Builds gp-neon-theme.sh: Neon theme (cyan / orange) + custom panel name, all files embedded.
A file is replaced only when it is in a known state (Game Panel 1.6.0, an earlier Neon version, or already this one)."""
import base64, hashlib, os, subprocess, sys

ROOT = os.environ.get('ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
OUT = os.environ.get('OUT', os.path.join(ROOT, 'cod4', 'install', 'gp-neon-theme.sh'))
PRISTINE = os.environ.get('PRISTINE', 'ef90e58')   # Game Panel 1.6.0
# every version of these files in this repository's history counts as known
PREVIOUS = subprocess.run(['git', '-C', ROOT, 'rev-list', '--reverse', '%s..HEAD' % PRISTINE],
                          capture_output=True, check=True).stdout.decode().split()
FILES = {
    'frontend': ['main.tsx', 'App.tsx', 'components/Sidebar.tsx', 'components/Login.tsx', 'components/app/AppShell.tsx',
                 'contexts/ThemeContext.tsx', 'contexts/BrandingContext.tsx', 'src/ui/theme/neon.css'],
    'backend': ['src/routes/branding.ts'],
}
# index.ts and api.ts are changed by other installers too: they only get small insertions (BRANDING_PATCH)

def git_show(rev, path):
    p = subprocess.run(['git', '-C', ROOT, 'show', '%s:%s' % (rev, path)], capture_output=True)
    return p.stdout if p.returncode == 0 else None

sha = lambda b: hashlib.sha256(b).hexdigest()
entries = []
for part, files in FILES.items():
    for f in files:
        rel = '%s/%s' % (part, f)
        final = open(os.path.join(ROOT, rel), 'rb').read()
        priors = sorted({sha(b) for b in [git_show(r, rel) for r in [PRISTINE] + PREVIOUS] if b is not None and b != final})
        new = git_show(PRISTINE, rel) is None
        entries.append((part, rel, base64.b64encode(final).decode(), priors, new))

py = ['import base64, hashlib, os, sys', 'root, backup = sys.argv[1], sys.argv[2]', 'files = [']
for part, rel, data, priors, new in entries:
    py.append('  (%r, %r, %r, %r, %r),' % (part, rel, data, priors, new))
py += [']',
'sha = lambda b: hashlib.sha256(b).hexdigest()',
'changed = set(); plan = []',
'for part, rel, data, priors, new in files:',
'    final = base64.b64decode(data); path = os.path.join(root, rel)',
'    cur = open(path, "rb").read() if os.path.exists(path) else None',
'    if cur == final: continue',
'    if (cur is None and new) or (cur is not None and sha(cur) in priors):',
'        plan.append((part, rel, path, final, cur))',
'    else:',
'        sys.exit("%s is different from the version this script knows (Game Panel 1.6.0). Nothing was changed." % rel)',
'for part, rel, path, final, cur in plan:',
'    os.makedirs(os.path.join(backup, os.path.dirname(rel)), exist_ok=True)',
'    open(os.path.join(backup, rel + (".orig" if cur is not None else ".new")), "wb").write(cur or b"")',
'    os.makedirs(os.path.dirname(path), exist_ok=True)',
'    open(path, "wb").write(final); changed.add(part)',
'print(" ".join(sorted(changed)))']
payload = base64.b64encode('\n'.join(py).encode()).decode()

branding_py = r"""import os, sys
root, backup = sys.argv[1], sys.argv[2]
changed = set()
def insert(part, rel, marker, anchor, text, after=True):
    path = os.path.join(root, rel)
    s = open(path).read()
    if marker in s:
        return
    if s.count(anchor) != 1:
        sys.exit('%s: unknown version (anchor not found). Nothing more was changed.' % rel)
    orig = os.path.join(backup, rel + '.orig')
    if not os.path.exists(orig):
        os.makedirs(os.path.dirname(orig), exist_ok=True)
        open(orig, 'w').write(s)
    open(path, 'w').write(s.replace(anchor, anchor + text if after else text + anchor))
    changed.add(part)
insert('backend', 'backend/src/index.ts', 'routes/branding.js', "import downloadRoutes from './routes/download.js';\n",
       "import brandingRoutes from './routes/branding.js';\n")
insert('backend', 'backend/src/index.ts', "app.use('/api/branding'", "app.use('/api/download', downloadRoutes);\n",
       "// /api/branding (custom panel name; reading needs no login)\napp.use('/api/branding', brandingRoutes);\n")
insert('frontend', 'frontend/utils/api.ts', 'getBranding', '  async installServer(payload: {\n',
       "  // custom panel name (null = the OVHcloud logo); reading needs no login\n"
       "  async getBranding() {\n"
       "    const response = await this.client.get('/api/branding');\n"
       "    return response.data as { name: string | null };\n"
       "  }\n\n"
       "  async setBranding(name: string) {\n"
       "    const response = await this.client.put('/api/branding', { name });\n"
       "    return response.data as { name: string | null };\n"
       "  }\n\n", after=False)
print(' '.join(sorted(changed)))
"""
branding = base64.b64encode(branding_py.encode()).decode()

script = r'''#!/usr/bin/env bash
# OVHcloud Game Panel: Neon theme (animated, cyan or orange) and a custom panel name.
# - ✨ button next to the light/dark button (sidebar): off → Neon → Neon orange → off
# - user menu (⋮) → "Panel name" (admins): your name instead of the OVHcloud Game Panel logo, for everybody
# Safe to run again (also after a panel update, which removes it).
set -euo pipefail
APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
cd /
SRC="$APP_ROOT/app"
DEPLOY="$APP_ROOT/deploy"
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
[[ -d $SRC/frontend && -d $SRC/backend && -f $DEPLOY/compose.yml ]] || { echo "Game Panel nije pronađen u $APP_ROOT"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
backup="$APP_ROOT/look-backup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$backup"
restore(){
  ( cd "$backup" && find . -type f ) | while read -r f; do
    f="${f#./}"
    case "$f" in
      *.orig) cp -p "$backup/$f" "$SRC/${f%.orig}" ;;
      *.new) rm -f "$SRC/${f%.new}" ;;
    esac
  done
  echo "Greška: izmjena vraćena (kopija u $backup)." >&2
}
changed="$(echo '__PAYLOAD__' | base64 -d | python3 - "$SRC" "$backup")"
trap 'rc=$?; ((rc)) && restore' EXIT
changed="$changed $(echo '__BRANDING__' | base64 -d | python3 - "$SRC" "$backup")"
changed="${changed# }"; changed="${changed% }"
dc(){ docker compose --project-name gamepanel --env-file "$DEPLOY/.env" -f "$DEPLOY/compose.yml" "$@"; }
if [[ -z $changed ]]; then
  echo "Neon tema i ime panela su već instalirani."
  rmdir "$backup" 2>/dev/null || true
else
  if [[ $changed == *backend* ]]; then echo "== Gradim backend panela..."; dc build backend; dc up -d backend; fi
  if [[ $changed == *frontend* ]]; then echo "== Gradim sučelje panela (par minuta)..."; dc build frontend; dc up -d frontend; fi
fi
trap - EXIT
echo
echo "Gotovo. Panel: Ctrl+Shift+R."
echo " - Tema: gumb ✨ dolje u bočnom izborniku (isključeno → Neon → Neon narančasti → isključeno)."
echo " - Ime panela: ⋮ (izbornik korisnika) → Panel name (samo admin)."
echo "Nakon nadogradnje Game Panela ponovno pokreni: sudo bash $0"
'''.replace('__PAYLOAD__', payload).replace('__BRANDING__', branding)
open(OUT, 'w').write(script)
os.chmod(OUT, 0o755)
print(OUT, len(script))
for part, rel, data, priors, new in entries:
    print('  %-40s %s' % (rel, 'new' if new else '%d known prior state(s)' % len(priors)))
