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
APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
# the current folder may have been deleted (docker compose then fails), so work from /
cd /
SRC="$APP_ROOT/app"
DEPLOY="$APP_ROOT/deploy"
AD="$SRC/backend/src/providers/linuxgsm/adapters"
SPEC="$SRC/backend/src/providers/linuxgsm/installSpec.ts"
TPL="$APP_ROOT/data/templates/cod4/serverfiles"
[[ $EUID -eq 0 ]] || { echo "Pokreni kao root: sudo bash $0"; exit 1; }
[[ -f $AD/registry.ts && -f $DEPLOY/compose.yml ]] || { echo "Game Panel nije pronađen u $APP_ROOT"; exit 1; }
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
dc(){ docker compose --project-name gamepanel --env-file "$DEPLOY/.env" -f "$DEPLOY/compose.yml" "$@"; }

# ---- 1) CoD4 changes in the panel (backend: template, slots, no update on start; install form: Slots) -----------
FORM="$SRC/frontend/components/InstallGameServer.tsx"
TYPES="$AD/types.ts"
SERVERS="$SRC/backend/src/services/servers.ts"
backup="$(mktemp -d)"
cp -p "$AD/registry.ts" "$SPEC" "$TYPES" "$SERVERS" "$FORM" "$backup/"
had=0; [[ -f $AD/cod4/index.ts ]] && { cp -p "$AD/cod4/index.ts" "$backup/"; had=1; }
restore(){
  cp -p "$backup/registry.ts" "$backup/types.ts" "$AD/"; cp -p "$backup/installSpec.ts" "$SPEC"
  cp -p "$backup/servers.ts" "$SERVERS"; cp -p "$backup/InstallGameServer.tsx" "$FORM"
  if ((had)); then cp -p "$backup/index.ts" "$AD/cod4/"; else rm -rf "$AD/cod4"; fi
  echo "Greška: izmjena panela vraćena." >&2
}
trap 'rc=$?; ((rc)) && restore' EXIT
mkdir -p "$AD/cod4"
echo 'aW1wb3J0IHsgY29uc3RhbnRzIH0gZnJvbSAnbm9kZTpmcyc7CmltcG9ydCBmcyBmcm9tICdub2RlOmZzL3Byb21pc2VzJzsKaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJzsKaW1wb3J0IHsgZ2V0Q29uZmlnIH0gZnJvbSAnLi4vLi4vLi4vLi4vY29uZmlnLmpzJzsKaW1wb3J0IHsgbG9nSW5mbywgbG9nV2FybiB9IGZyb20gJy4uLy4uLy4uLy4uL3V0aWxzL2xvZ2dlci5qcyc7CmltcG9ydCB7IGFwcGx5TGludXhHc21Db25maWdQYXRjaGVzIH0gZnJvbSAnLi4vbGludXhHc21Db25maWcuanMnOwppbXBvcnQgeyBydW5HZW5lcmljQmVmb3JlQ29udGFpbmVyQ3JlYXRlIH0gZnJvbSAnLi4vZ2VuZXJpYy9pbmRleC5qcyc7CmltcG9ydCB0eXBlIHsKICAgIEFmdGVyQ29udGFpbmVyU3RhcnRDb250ZXh0LAogICAgQmVmb3JlQ29udGFpbmVyQ3JlYXRlQ29udGV4dCwKICAgIEdhbWVBZGFwdGVyLAp9IGZyb20gJy4uL3R5cGVzLmpzJzsKCi8vIENhbGwgb2YgRHV0eSA0OiBuZXcgc2VydmVycyBzdGFydCBmcm9tIGEgbG9jYWwgY29weSBvZiB0aGUgZ2FtZSBmaWxlcyAobWFkZSBmcm9tIGFuIGV4aXN0aW5nIHNlcnZlciB3aXRoCi8vIGdwLWNvZDQtdGVtcGxhdGUuc2gpIGluc3RlYWQgb2YgZG93bmxvYWRpbmcgdGhlbS4gVGhlIExpbnV4R1NNIGltYWdlIG9ubHkgaW5zdGFsbHMgd2hlbiBzZXJ2ZXJmaWxlcyBpcyBlbXB0eS4KZXhwb3J0IGZ1bmN0aW9uIGNvZDRUZW1wbGF0ZURpcigpOiBzdHJpbmcgewogICAgcmV0dXJuIHBhdGguam9pbihnZXRDb25maWcoKS5nYW1lcGFuZWxEYXRhRGlyLCAndGVtcGxhdGVzJywgJ2NvZDQnLCAnc2VydmVyZmlsZXMnKTsKfQoKYXN5bmMgZnVuY3Rpb24gaXNFbXB0eURpcihkaXI6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4gewogICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIoZGlyKS5jYXRjaCgoKSA9PiBudWxsKTsKICAgIHJldHVybiBlbnRyaWVzID09PSBudWxsIHx8IGVudHJpZXMubGVuZ3RoID09PSAwOwp9CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gY29weUNvZDRUZW1wbGF0ZShkYXRhRGlyOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHsKICAgIGNvbnN0IHRlbXBsYXRlID0gY29kNFRlbXBsYXRlRGlyKCk7CiAgICBpZiAoYXdhaXQgaXNFbXB0eURpcih0ZW1wbGF0ZSkpIHJldHVybiBmYWxzZTsKICAgIGNvbnN0IHRhcmdldCA9IHBhdGguam9pbihkYXRhRGlyLCAnc2VydmVyZmlsZXMnKTsKICAgIGlmICghKGF3YWl0IGlzRW1wdHlEaXIodGFyZ2V0KSkpIHJldHVybiBmYWxzZTsKICAgIC8vIEZJQ0xPTkUgbWFrZXMgYSBjb3B5LW9uLXdyaXRlIGNsb25lIHdoZXJlIHRoZSBmaWxlc3lzdGVtIHN1cHBvcnRzIGl0IGFuZCBhIG5vcm1hbCBjb3B5IGVsc2V3aGVyZQogICAgYXdhaXQgZnMuY3AodGVtcGxhdGUsIHRhcmdldCwgeyByZWN1cnNpdmU6IHRydWUsIHZlcmJhdGltU3ltbGlua3M6IHRydWUsIG1vZGU6IGNvbnN0YW50cy5DT1BZRklMRV9GSUNMT05FIH0pOwogICAgcmV0dXJuIHRydWU7Cn0KCi8vIHNsb3RzIGNob3NlbiBpbiB0aGUgaW5zdGFsbCBmb3JtIChDT0Q0X01BWFBMQVlFUlMpLCB3cml0dGVuIGFzIExpbnV4R1NNJ3MgbWF4cGxheWVycyAoK3NldCBzdl9tYXhjbGllbnRzKQpleHBvcnQgZnVuY3Rpb24gY29kNE1heFBsYXllcnMoZW52OiBzdHJpbmdbXSB8IHVuZGVmaW5lZCk6IG51bWJlciB8IG51bGwgewogICAgY29uc3QgcmF3ID0gKGVudiA/PyBbXSkuZmluZCgoZW50cnkpID0+IGVudHJ5LnN0YXJ0c1dpdGgoJ0NPRDRfTUFYUExBWUVSUz0nKSk/LnNsaWNlKCdDT0Q0X01BWFBMQVlFUlM9Jy5sZW5ndGgpLnRyaW0oKSA/PyAnJzsKICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKHJhdyk7CiAgICByZXR1cm4gL15cZCskLy50ZXN0KHJhdykgJiYgdmFsdWUgPj0gMSAmJiB2YWx1ZSA8PSA2NCA/IHZhbHVlIDogbnVsbDsKfQoKZXhwb3J0IGNvbnN0IGNvZDRBZGFwdGVyOiBHYW1lQWRhcHRlciA9IHsKICAgIGFzeW5jIGJlZm9yZUNvbnRhaW5lckNyZWF0ZShjdHg6IEJlZm9yZUNvbnRhaW5lckNyZWF0ZUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHsKICAgICAgICBhd2FpdCBydW5HZW5lcmljQmVmb3JlQ29udGFpbmVyQ3JlYXRlKGN0eCk7CiAgICAgICAgY29uc3Qgc2xvdHMgPSBjb2Q0TWF4UGxheWVycyhjdHguZW52KTsKICAgICAgICBpZiAoc2xvdHMgIT09IG51bGwpIHsKICAgICAgICAgICAgYXdhaXQgYXBwbHlMaW51eEdzbUNvbmZpZ1BhdGNoZXMoeyBkYXRhRGlyOiBjdHguZGF0YURpciwgZ2FtZVNlcnZlck5hbWU6IGN0eC5nYW1lU2VydmVyTmFtZSB9LCBbCiAgICAgICAgICAgICAgICB7IGZpbGVOYW1lOiBgJHtjdHguZ2FtZVNlcnZlck5hbWV9LmNmZ2AsIHZhbHVlczogeyBtYXhwbGF5ZXJzOiBTdHJpbmcoc2xvdHMpIH0gfSwKICAgICAgICAgICAgXSk7CiAgICAgICAgfQogICAgICAgIHRyeSB7CiAgICAgICAgICAgIGlmIChhd2FpdCBjb3B5Q29kNFRlbXBsYXRlKGN0eC5kYXRhRGlyKSkgewogICAgICAgICAgICAgICAgbG9nSW5mbygnTElOVVhHU006Q09ENCcsICdHYW1lIGZpbGVzIGNvcGllZCBmcm9tIHRoZSBsb2NhbCB0ZW1wbGF0ZSwgbm8gZG93bmxvYWQgbmVlZGVkJywgeyBzZXJ2ZXJJZDogY3R4LnNlcnZlcklkIH0pOwogICAgICAgICAgICB9CiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHsKICAgICAgICAgICAgLy8gYSBmYWlsZWQgY29weSBtdXN0IG5vdCBibG9jayB0aGUgaW5zdGFsbDogTGludXhHU00gdGhlbiBkb3dubG9hZHMgdGhlIGZpbGVzIGFzIHVzdWFsCiAgICAgICAgICAgIGxvZ1dhcm4oJ0xJTlVYR1NNOkNPRDQnLCBgQ291bGQgbm90IGNvcHkgdGhlIENvRDQgdGVtcGxhdGU6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIHsKICAgICAgICAgICAgICAgIHNlcnZlcklkOiBjdHguc2VydmVySWQsCiAgICAgICAgICAgIH0pOwogICAgICAgICAgICBhd2FpdCBmcy5ybShwYXRoLmpvaW4oY3R4LmRhdGFEaXIsICdzZXJ2ZXJmaWxlcycpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTsKICAgICAgICB9CiAgICB9LAogICAgYXN5bmMgYWZ0ZXJDb250YWluZXJTdGFydChfY3R4OiBBZnRlckNvbnRhaW5lclN0YXJ0Q29udGV4dCk6IFByb21pc2U8dm9pZD4gewogICAgICAgIHJldHVybjsKICAgIH0sCn07Cg==' | base64 -d > "$AD/cod4/index.ts"
echo 'aW1wb3J0IHN5cwpwID0gc3lzLmFyZ3ZbMV0KcyA9IG9wZW4ocCkucmVhZCgpCmlmICdjb2Q0QWRhcHRlcicgaW4gczoKICAgIHN5cy5leGl0KDApCmltcCA9ICJpbXBvcnQgeyB2aEFkYXB0ZXIgfSBmcm9tICcuL3ZoL2luZGV4LmpzJztcbiIKcmVnID0gIiAgICB2aDogdmhBZGFwdGVyLFxuIgppZiBpbXAgbm90IGluIHMgb3IgcmVnIG5vdCBpbiBzOgogICAgc3lzLmV4aXQoJ3JlZ2lzdHJ5LnRzIGxvb2tzIGRpZmZlcmVudCB0aGFuIGV4cGVjdGVkJykKcyA9IHMucmVwbGFjZShpbXAsIGltcCArICJpbXBvcnQgeyBjb2Q0QWRhcHRlciB9IGZyb20gJy4vY29kNC9pbmRleC5qcyc7XG4iLCAxKS5yZXBsYWNlKHJlZywgcmVnICsgIiAgICBjb2Q0OiBjb2Q0QWRhcHRlcixcbiIsIDEpCm9wZW4ocCwgJ3cnKS53cml0ZShzKQo=' | base64 -d | python3 - "$AD/registry.ts"
# new CoD4 servers: no LinuxGSM update check on GitHub at every start (UPDATE_ON_START=false)
echo 'aW1wb3J0IHN5cwpwID0gc3lzLmFyZ3ZbMV0KcyA9IG9wZW4ocCkucmVhZCgpCmlmICd3aXRoQ29kNERlZmF1bHRzJyBpbiBzOgogICAgc3lzLmV4aXQoMCkKb2xkX2NhbGwgPSAiICAgICAgICBlbnY6IG5vcm1hbGl6ZUxpbnV4R3NtRW52KGN0eC5ib2R5LmVudiksXG4iCmFuY2hvciA9ICJleHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxpbnV4R3NtSW5zdGFsbFNwZWMoIgppZiBvbGRfY2FsbCBub3QgaW4gcyBvciBhbmNob3Igbm90IGluIHM6CiAgICBzeXMuZXhpdCgnaW5zdGFsbFNwZWMudHMgbG9va3MgZGlmZmVyZW50IHRoYW4gZXhwZWN0ZWQnKQpzID0gcy5yZXBsYWNlKG9sZF9jYWxsLCAiICAgICAgICBlbnY6IHdpdGhDb2Q0RGVmYXVsdHMoZ2FtZS5zaG9ydG5hbWUsIG5vcm1hbGl6ZUxpbnV4R3NtRW52KGN0eC5ib2R5LmVudikpLFxuIiwgMSkKcyA9IHMucmVwbGFjZShhbmNob3IsICIiIi8vIENhbGwgb2YgRHV0eSA0OiBubyBMaW51eEdTTSB1cGRhdGUgKGEgR2l0SHViIGNoZWNrKSBvbiBldmVyeSBjb250YWluZXIgc3RhcnQsIHNvIHRoZSBzZXJ2ZXIgY29tZXMgb25saW5lIHF1aWNrbHkuCi8vIFVQREFURV9PTl9TVEFSVCBjYW4gc3RpbGwgYmUgc2V0IGluIHRoZSBzZXJ2ZXIncyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuCmZ1bmN0aW9uIHdpdGhDb2Q0RGVmYXVsdHMoc2hvcnRuYW1lOiBzdHJpbmcsIGVudjogc3RyaW5nW10pOiBzdHJpbmdbXSB7CiAgICBpZiAoc2hvcnRuYW1lICE9PSAnY29kNCcgfHwgZW52LnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5zdGFydHNXaXRoKCdVUERBVEVfT05fU1RBUlQ9JykpKSByZXR1cm4gZW52OwogICAgcmV0dXJuIFsuLi5lbnYsICdVUERBVEVfT05fU1RBUlQ9ZmFsc2UnXTsKfQoKIiIiICsgYW5jaG9yLCAxKQpvcGVuKHAsICd3Jykud3JpdGUocykK' | base64 -d | python3 - "$SPEC"
# the install form's Slots reach the CoD4 step as COD4_MAXPLAYERS
echo 'aW1wb3J0IHN5cwp0eXBlc19wLCBzZXJ2ZXJzX3AgPSBzeXMuYXJndlsxXSwgc3lzLmFyZ3ZbMl0KdCA9IG9wZW4odHlwZXNfcCkucmVhZCgpCmlmICdlbnY/OiBzdHJpbmdbXTsnIG5vdCBpbiB0OgogICAgYSA9ICIgICAgc3RlYW1DcmVkZW50aWFsczogU3RlYW1DcmVkZW50aWFscyB8IG51bGw7XG59OyIKICAgIGlmIHQuY291bnQoYSkgIT0gMToKICAgICAgICBzeXMuZXhpdCgndHlwZXMudHMgbG9va3MgZGlmZmVyZW50IHRoYW4gZXhwZWN0ZWQnKQogICAgdCA9IHQucmVwbGFjZShhLCAiICAgIHN0ZWFtQ3JlZGVudGlhbHM6IFN0ZWFtQ3JlZGVudGlhbHMgfCBudWxsO1xuICAgIC8vIHRoZSBzZXJ2ZXIncyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgKEtFWT1WQUxVRSlcbiAgICBlbnY/OiBzdHJpbmdbXTtcbn07IiwgMSkKICAgIG9wZW4odHlwZXNfcCwgJ3cnKS53cml0ZSh0KQpzID0gb3BlbihzZXJ2ZXJzX3ApLnJlYWQoKQppZiAnZW52OiBzcGVjLmVudixcbiAgICAgICAgICAgIH0pOycgbm90IGluIHM6CiAgICBhID0gIiIiICAgICAgICAgICAgICAgIGRhdGFEaXI6IHN0b3JhZ2UuZGF0YURpciwKICAgICAgICAgICAgICAgIHN0ZWFtQ3JlZGVudGlhbHM6IHNwZWMuc3RlYW1DcmVkZW50aWFscywKICAgICAgICAgICAgfSk7IiIiCiAgICBpZiBzLmNvdW50KGEpICE9IDE6CiAgICAgICAgc3lzLmV4aXQoJ3NlcnZlcnMudHMgbG9va3MgZGlmZmVyZW50IHRoYW4gZXhwZWN0ZWQnKQogICAgcyA9IHMucmVwbGFjZShhLCAiIiIgICAgICAgICAgICAgICAgZGF0YURpcjogc3RvcmFnZS5kYXRhRGlyLAogICAgICAgICAgICAgICAgc3RlYW1DcmVkZW50aWFsczogc3BlYy5zdGVhbUNyZWRlbnRpYWxzLAogICAgICAgICAgICAgICAgZW52OiBzcGVjLmVudiwKICAgICAgICAgICAgfSk7IiIiLCAxKQogICAgb3BlbihzZXJ2ZXJzX3AsICd3Jykud3JpdGUocykK' | base64 -d | python3 - "$TYPES" "$SERVERS"
echo 'aW1wb3J0IHN5cwpwID0gc3lzLmFyZ3ZbMV0KcyA9IG9wZW4ocCkucmVhZCgpCmlmICdDT0Q0X01BWFBMQVlFUlMnIGluIHM6CiAgICBzeXMuZXhpdCgwKQpwYWlycyA9IFsKKCIgIHNob3dWYWxoZWltRmllbGRzPzogYm9vbGVhbjtcbiAgdXNlZFNlcnZlck5hbWVzPzogc3RyaW5nW107IiwgIiAgc2hvd1ZhbGhlaW1GaWVsZHM/OiBib29sZWFuO1xuICBzaG93Q29kNEZpZWxkcz86IGJvb2xlYW47XG4gIHVzZWRTZXJ2ZXJOYW1lcz86IHN0cmluZ1tdOyIpLAooIiAgc2hvd1ZhbGhlaW1GaWVsZHMsXG4gIHVzZWRTZXJ2ZXJOYW1lcywiLCAiICBzaG93VmFsaGVpbUZpZWxkcyxcbiAgc2hvd0NvZDRGaWVsZHMsXG4gIHVzZWRTZXJ2ZXJOYW1lcywiKSwKKCIiIiAgY29uc3QgdmFsaGVpbVBhc3N3b3JkVG9vU2hvcnQgPSBCb29sZWFuKHNob3dWYWxoZWltRmllbGRzKSAmJiB2YWxoZWltUGFzc3dvcmQudHJpbSgpLmxlbmd0aCA8IDU7CiIiIiwgIiIiICBjb25zdCB2YWxoZWltUGFzc3dvcmRUb29TaG9ydCA9IEJvb2xlYW4oc2hvd1ZhbGhlaW1GaWVsZHMpICYmIHZhbGhlaW1QYXNzd29yZC50cmltKCkubGVuZ3RoIDwgNTsKCiAgLy8gQ2FsbCBvZiBEdXR5IDQgc2xvdHM6IHRoZSBiYWNrZW5kIHdyaXRlcyB0aGVtIGFzIExpbnV4R1NNJ3MgbWF4cGxheWVycyAoK3NldCBzdl9tYXhjbGllbnRzKQogIGNvbnN0IGNvZDRTbG90cyA9IGVudlJvd3MuZmluZCgocikgPT4gci5rZXkudHJpbSgpLnRvVXBwZXJDYXNlKCkgPT09ICdDT0Q0X01BWFBMQVlFUlMnKT8udmFsdWUgPz8gJyc7CiAgY29uc3Qgc2V0Q29kNFNsb3RzID0gKHZhbDogc3RyaW5nKSA9PiB1cHNlcnRFbnYoJ0NPRDRfTUFYUExBWUVSUycsIHZhbCk7CiAgY29uc3QgY29kNFNsb3RzSW52YWxpZCA9CiAgICBCb29sZWFuKHNob3dDb2Q0RmllbGRzKSAmJiAhKC9eXFxkKyQvLnRlc3QoY29kNFNsb3RzLnRyaW0oKSkgJiYgTnVtYmVyKGNvZDRTbG90cykgPj0gMSAmJiBOdW1iZXIoY29kNFNsb3RzKSA8PSA2NCk7CiAgUmVhY3QudXNlRWZmZWN0KCgpID0+IHsKICAgIGlmIChzaG93Q29kNEZpZWxkcyAmJiAhZW52Um93cy5zb21lKChyKSA9PiByLmtleS50cmltKCkudG9VcHBlckNhc2UoKSA9PT0gJ0NPRDRfTUFYUExBWUVSUycpKSB7CiAgICAgIHNldEVudlJvd3MoWy4uLmVudlJvd3MsIHsga2V5OiAnQ09ENF9NQVhQTEFZRVJTJywgdmFsdWU6ICczMicgfV0pOwogICAgfQogIH0sIFtzaG93Q29kNEZpZWxkcywgZW52Um93cywgc2V0RW52Um93c10pOwoiIiIpLAooIiIiICAgICAgICAgIHtzaG93UHJvamVjdFpvbWJvaWRGaWVsZHMgJiYgKAogICAgICAgICAgICA8PiIiIiwgIiIiICAgICAgICAgIHtzaG93Q29kNEZpZWxkcyAmJiAoCiAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTEuNSB0ZXh0LXhzIGZvbnQtc2VtaWJvbGQgdGV4dC1ncmF5LTUwMCBkYXJrOnRleHQtZ3JheS00MDAgdXBwZXJjYXNlIHRyYWNraW5nLXdpZGVyIG1iLTIiPgogICAgICAgICAgICAgICAgU2xvdHMKICAgICAgICAgICAgICAgIDxJbmZvVGlwIHRleHQ9Ik1heGltdW0gbnVtYmVyIG9mIHBsYXllcnMgKHN2X21heGNsaWVudHMpLCAxIHRvIDY0LiBZb3UgY2FuIGNoYW5nZSBpdCBsYXRlciBpbiBTZXR0aW5ncyA+IEdhbWUgY29uZmlnID4gQ29tbWFuZCBsaW5lLiIgLz4KICAgICAgICAgICAgICA8L2xhYmVsPgogICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICAgdHlwZT0ibnVtYmVyIgogICAgICAgICAgICAgICAgbWluPXsxfQogICAgICAgICAgICAgICAgbWF4PXs2NH0KICAgICAgICAgICAgICAgIHZhbHVlPXtjb2Q0U2xvdHN9CiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldENvZDRTbG90cyhlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2Ake2lucHV0Q2xzfSBtYXgtdy1bMTByZW1dYH0KICAgICAgICAgICAgICAvPgogICAgICAgICAgICAgIHtjb2Q0U2xvdHNJbnZhbGlkICYmIDxwIGNsYXNzTmFtZT0ibXQtMS41IHRleHQteHMgdGV4dC1yZWQtNDAwIj5FbnRlciBhIG51bWJlciBmcm9tIDEgdG8gNjQuPC9wPn0KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICApfQoKICAgICAgICAgIHtzaG93UHJvamVjdFpvbWJvaWRGaWVsZHMgJiYgKAogICAgICAgICAgICA8PiIiIiksCigiZGlzYWJsZWQ9e2xvYWRpbmcgfHwgIXNlcnZlck5hbWUudHJpbSgpIHx8IGV1bGFCbG9ja2VkIHx8IHJ1c3RSY29uVG9vU2hvcnQgfHwgdmFsaGVpbVBhc3N3b3JkVG9vU2hvcnR9IiwgImRpc2FibGVkPXtsb2FkaW5nIHx8ICFzZXJ2ZXJOYW1lLnRyaW0oKSB8fCBldWxhQmxvY2tlZCB8fCBydXN0UmNvblRvb1Nob3J0IHx8IHZhbGhlaW1QYXNzd29yZFRvb1Nob3J0IHx8IGNvZDRTbG90c0ludmFsaWR9IiksCigiICBjb25zdCBbc2hvd1J1c3QsIHNldFNob3dSdXN0XSA9IHVzZVN0YXRlKGZhbHNlKTtcbiIsICIgIGNvbnN0IFtzaG93UnVzdCwgc2V0U2hvd1J1c3RdID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbc2hvd0NvZDQsIHNldFNob3dDb2Q0XSA9IHVzZVN0YXRlKGZhbHNlKTtcbiIpLAooIiAgICAgICAgICBzaG93VmFsaGVpbUZpZWxkcz17c2hvd1ZhbGhlaW19XG4gICAgICAgICAgdXNlZFNlcnZlck5hbWVzPXt1c2VkU2VydmVyTmFtZXN9IiwgIiAgICAgICAgICBzaG93VmFsaGVpbUZpZWxkcz17c2hvd1ZhbGhlaW19XG4gICAgICAgICAgc2hvd0NvZDRGaWVsZHM9e3Nob3dDb2Q0fVxuICAgICAgICAgIHVzZWRTZXJ2ZXJOYW1lcz17dXNlZFNlcnZlck5hbWVzfSIpLAooIiIiICAgIHNldENvbmZpZ1Byb3ZpZGVyKCdsaW51eGdzbScpOwogICAgc2V0U2VydmVyTmFtZShtYWtlVW5pcXVlU2VydmVyTmFtZShgJHtnYW1lLmdhbWVuYW1lfSBTZXJ2ZXJgLCB1c2VkU2VydmVyTmFtZXMpKTsiIiIsICIiIiAgICBzZXRDb25maWdQcm92aWRlcignbGludXhnc20nKTsKICAgIHNldFNob3dDb2Q0KGdhbWUuc2hvcnRuYW1lID09PSAnY29kNCcpOwogICAgc2V0U2VydmVyTmFtZShtYWtlVW5pcXVlU2VydmVyTmFtZShgJHtnYW1lLmdhbWVuYW1lfSBTZXJ2ZXJgLCB1c2VkU2VydmVyTmFtZXMpKTsiIiIpLAooIiAgICBzZXRTaG93VmFsaGVpbShmYWxzZSk7XG4iLCAiICAgIHNldFNob3dWYWxoZWltKGZhbHNlKTtcbiAgICBzZXRTaG93Q29kNChmYWxzZSk7XG4iKSwKXQpmb3IgYSwgYiBpbiBwYWlyczoKICAgIGlmIHMuY291bnQoYSkgIT0gMToKICAgICAgICBzeXMuZXhpdCgnSW5zdGFsbEdhbWVTZXJ2ZXIudHN4IGxvb2tzIGRpZmZlcmVudCB0aGFuIGV4cGVjdGVkJykKICAgIHMgPSBzLnJlcGxhY2UoYSwgYikKb3BlbihwLCAndycpLndyaXRlKHMpCg==' | base64 -d | python3 - "$FORM"
backend_changed=0; frontend_changed=0
for f in registry.ts:$AD/registry.ts installSpec.ts:$SPEC types.ts:$TYPES servers.ts:$SERVERS; do
  cmp -s "$backup/${f%%:*}" "${f#*:}" || backend_changed=1
done
((had)) && cmp -s "$backup/index.ts" "$AD/cod4/index.ts" || backend_changed=1
cmp -s "$backup/InstallGameServer.tsx" "$FORM" || frontend_changed=1
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
rm -rf "$backup"

# ---- 2) the template ---------------------------------------------------------------------------------------------
cod4_servers(){ for d in "$APP_ROOT"/servers/*/data; do [[ -d $d/config-lgsm/cod4server && -d $d/serverfiles ]] && basename "$(dirname "$d")"; done; }
case "${1:-}" in
  "")
    echo
    echo "Tvoji CoD4 serveri:"
    found=0
    for k in $(cod4_servers); do
      found=1
      d="$APP_ROOT/servers/$k/data/serverfiles"
      name="$(grep -hoE 'sv_hostname +"[^"]*"' "$d"/main/*.cfg "$d"/mods/*/*.cfg 2>/dev/null | head -1 | sed 's/sv_hostname *//' || true)"
      printf '  %-6s %-8s %s\n' "$k" "$(du -sh "$d" 2>/dev/null | cut -f1)" "${name:-}"
    done
    ((found)) || echo "  (nema)"
    if [[ -d $TPL ]]; then echo; echo "Trenutni predložak: $(du -sh "$TPL" | cut -f1) ($(cat "$TPL/../source.txt" 2>/dev/null || echo ?))"; fi
    echo
    echo "Napravi predložak:  sudo bash $0 <broj servera>"
    ;;
  --remove)
    rm -rf "$APP_ROOT/data/templates/cod4"
    echo "Predložak obrisan. Novi CoD4 serveri ponovno skidaju datoteke."
    ;;
  *)
    k="$1"
    [[ $k =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Neispravan broj servera: $k"; exit 1; }
    src="$APP_ROOT/servers/$k/data/serverfiles"
    [[ -d $src && -d $APP_ROOT/servers/$k/data/config-lgsm/cod4server ]] || { echo "Server $k nije CoD4 server (nema $src)"; exit 1; }
    [[ -n "$(ls -A "$src")" ]] || { echo "Server $k još nema datoteke (instalacija nije gotova)"; exit 1; }
    echo "== Kopiram serverfiles servera $k ($(du -sh "$src" | cut -f1)) ..."
    tmp="$APP_ROOT/data/templates/cod4/serverfiles.new"
    rm -rf "$tmp"; mkdir -p "$tmp"
    cp -a "$src/." "$tmp/"
    # log files belong to the source server only
    find "$tmp" -type f \( -name '*.log' -o -name 'games_mp.log*' \) -delete
    chmod -R a+rX "$tmp"
    rm -rf "$TPL"; mv "$tmp" "$TPL"
    echo "server $k, $(date '+%F %T')" > "$TPL/../source.txt"
    echo
    echo "Gotovo. Predložak: $(du -sh "$TPL" | cut -f1)."
    echo "Svaki novi CoD4 server koji instaliraš u panelu dobije ove datoteke odmah, bez skidanja."
    echo "Kad promijeniš modove ili mape na serveru $k, pokreni ovo ponovno da osvježiš predložak."
    ;;
esac
