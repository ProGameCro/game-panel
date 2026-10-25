import sys
p = sys.argv[1]
s = open(p).read()
if 'B3Section' in s:
    sys.exit(0)
imp = "import { Cod4ModSection, type Cod4ModSectionProps } from './serverSettings/Cod4ModSection';\n"
if imp not in s or '              <Cod4ModSection\n' not in s:
    sys.exit('GameConfigTab.tsx has no CoD4 Command line card')
s = s.replace(imp, imp + "import { B3Section } from './serverSettings/B3Section';\n", 1)
i = s.index('              <Cod4ModSection\n')
j = s.index('/>', i) + 2
s = s[:j] + """
              <B3Section
                {...cod4Props}
                canReadFileManager={canReadFileManager}
                canWriteFileManager={canWriteFileManager}
                onOpenFileManagerPath={onOpenFileManagerPath ? openFileInFileManager : undefined}
              />""" + s[j:]
open(p, 'w').write(s)
