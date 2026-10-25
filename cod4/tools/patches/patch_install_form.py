import sys
p = sys.argv[1]
s = open(p).read()
if 'COD4_MAXPLAYERS' in s:
    sys.exit(0)
pairs = [
("  showValheimFields?: boolean;\n  usedServerNames?: string[];", "  showValheimFields?: boolean;\n  showCod4Fields?: boolean;\n  usedServerNames?: string[];"),
("  showValheimFields,\n  usedServerNames,", "  showValheimFields,\n  showCod4Fields,\n  usedServerNames,"),
("""  const valheimPasswordTooShort = Boolean(showValheimFields) && valheimPassword.trim().length < 5;
""", """  const valheimPasswordTooShort = Boolean(showValheimFields) && valheimPassword.trim().length < 5;

  // Call of Duty 4 slots: the backend writes them as LinuxGSM's maxplayers (+set sv_maxclients)
  const cod4Slots = envRows.find((r) => r.key.trim().toUpperCase() === 'COD4_MAXPLAYERS')?.value ?? '';
  const setCod4Slots = (val: string) => upsertEnv('COD4_MAXPLAYERS', val);
  const cod4SlotsInvalid =
    Boolean(showCod4Fields) && !(/^\\d+$/.test(cod4Slots.trim()) && Number(cod4Slots) >= 1 && Number(cod4Slots) <= 64);
  React.useEffect(() => {
    if (showCod4Fields && !envRows.some((r) => r.key.trim().toUpperCase() === 'COD4_MAXPLAYERS')) {
      setEnvRows([...envRows, { key: 'COD4_MAXPLAYERS', value: '32' }]);
    }
  }, [showCod4Fields, envRows, setEnvRows]);
"""),
("""          {showProjectZomboidFields && (
            <>""", """          {showCod4Fields && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Slots
                <InfoTip text="Maximum number of players (sv_maxclients), 1 to 64. You can change it later in Settings > Game config > Command line." />
              </label>
              <input
                type="number"
                min={1}
                max={64}
                value={cod4Slots}
                onChange={(e) => setCod4Slots(e.target.value)}
                className={`${inputCls} max-w-[10rem]`}
              />
              {cod4SlotsInvalid && <p className="mt-1.5 text-xs text-red-400">Enter a number from 1 to 64.</p>}
            </div>
          )}

          {showProjectZomboidFields && (
            <>"""),
("disabled={loading || !serverName.trim() || eulaBlocked || rustRconTooShort || valheimPasswordTooShort}", "disabled={loading || !serverName.trim() || eulaBlocked || rustRconTooShort || valheimPasswordTooShort || cod4SlotsInvalid}"),
("  const [showRust, setShowRust] = useState(false);\n", "  const [showRust, setShowRust] = useState(false);\n  const [showCod4, setShowCod4] = useState(false);\n"),
("          showValheimFields={showValheim}\n          usedServerNames={usedServerNames}", "          showValheimFields={showValheim}\n          showCod4Fields={showCod4}\n          usedServerNames={usedServerNames}"),
("""    setConfigProvider('linuxgsm');
    setServerName(makeUniqueServerName(`${game.gamename} Server`, usedServerNames));""", """    setConfigProvider('linuxgsm');
    setShowCod4(game.shortname === 'cod4');
    setServerName(makeUniqueServerName(`${game.gamename} Server`, usedServerNames));"""),
("    setShowValheim(false);\n", "    setShowValheim(false);\n    setShowCod4(false);\n"),
]
for a, b in pairs:
    if s.count(a) != 1:
        sys.exit('InstallGameServer.tsx looks different than expected')
    s = s.replace(a, b)
open(p, 'w').write(s)
