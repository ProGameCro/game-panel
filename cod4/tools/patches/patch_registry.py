import sys
p = sys.argv[1]
s = open(p).read()
if 'cod4Adapter' in s:
    sys.exit(0)
imp = "import { vhAdapter } from './vh/index.js';\n"
reg = "    vh: vhAdapter,\n"
if imp not in s or reg not in s:
    sys.exit('registry.ts looks different than expected')
s = s.replace(imp, imp + "import { cod4Adapter } from './cod4/index.js';\n", 1).replace(reg, reg + "    cod4: cod4Adapter,\n", 1)
open(p, 'w').write(s)
