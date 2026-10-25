import sys
p = sys.argv[1]
s = open(p).read()
if 'withCod4Defaults' in s:
    sys.exit(0)
old_call = "        env: normalizeLinuxGsmEnv(ctx.body.env),\n"
anchor = "export async function resolveLinuxGsmInstallSpec("
if old_call not in s or anchor not in s:
    sys.exit('installSpec.ts looks different than expected')
s = s.replace(old_call, "        env: withCod4Defaults(game.shortname, normalizeLinuxGsmEnv(ctx.body.env)),\n", 1)
s = s.replace(anchor, """// Call of Duty 4: no LinuxGSM update (a GitHub check) on every container start, so the server comes online quickly.
// UPDATE_ON_START can still be set in the server's environment variables.
function withCod4Defaults(shortname: string, env: string[]): string[] {
    if (shortname !== 'cod4' || env.some((entry) => entry.startsWith('UPDATE_ON_START='))) return env;
    return [...env, 'UPDATE_ON_START=false'];
}

""" + anchor, 1)
open(p, 'w').write(s)
