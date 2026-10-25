import sys
p = sys.argv[1]
s = open(p).read()
if 'neon.css' in s:
    sys.exit(0)
a = "import './styles/globals.css';\n"
if a not in s:
    sys.exit('main.tsx looks different than expected')
open(p, 'w').write(s.replace(a, a + "import './src/ui/theme/neon.css';\n", 1))
