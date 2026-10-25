import sys
types_p, servers_p = sys.argv[1], sys.argv[2]
t = open(types_p).read()
if 'env?: string[];' not in t:
    a = "    steamCredentials: SteamCredentials | null;\n};"
    if t.count(a) != 1:
        sys.exit('types.ts looks different than expected')
    t = t.replace(a, "    steamCredentials: SteamCredentials | null;\n    // the server's environment variables (KEY=VALUE)\n    env?: string[];\n};", 1)
    open(types_p, 'w').write(t)
s = open(servers_p).read()
if 'env: spec.env,\n            });' not in s:
    a = """                dataDir: storage.dataDir,
                steamCredentials: spec.steamCredentials,
            });"""
    if s.count(a) != 1:
        sys.exit('servers.ts looks different than expected')
    s = s.replace(a, """                dataDir: storage.dataDir,
                steamCredentials: spec.steamCredentials,
                env: spec.env,
            });""", 1)
    open(servers_p, 'w').write(s)
