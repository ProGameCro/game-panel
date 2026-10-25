import sys
p = sys.argv[1]
s = open(p).read()
if 'toggleNeon' in s:
    sys.exit(0)
pairs = [
("import { KeyRound, Moon, MoreVertical, Power, Sun, X } from 'lucide-react';", "import { KeyRound, Moon, MoreVertical, Power, Sparkles, Sun, X } from 'lucide-react';"),
("""  isDark: boolean;
  toggleTheme: () => void;
  onChangePassword?: () => void;""", """  isDark: boolean;
  toggleTheme: () => void;
  neon: boolean;
  toggleNeon: () => void;
  onChangePassword?: () => void;"""),
("""  isDark,
  toggleTheme,
  onChangePassword,
  onLogout,
}: UserMenuRowProps) {""", """  isDark,
  toggleTheme,
  neon,
  toggleNeon,
  onChangePassword,
  onLogout,
}: UserMenuRowProps) {"""),
("""        {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>""", """        {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={toggleNeon}
        className={`gp-neon-toggle cursor-pointer shrink-0 rounded-md p-1 transition-colors ${neon ? 'text-fuchsia-300 hover:bg-white/10' : isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
        aria-label={neon ? 'Turn off the neon theme' : 'Turn on the neon theme (animated)'}
        aria-pressed={neon}
        title={neon ? 'Turn off the neon theme' : 'Neon theme (animated)'}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>"""),
("  const { theme, toggleTheme } = useTheme();", "  const { theme, toggleTheme, neon, toggleNeon } = useTheme();"),
("""          isDark={isDark}
          toggleTheme={toggleTheme}
          onChangePassword={onChangePassword}""", """          isDark={isDark}
          toggleTheme={toggleTheme}
          neon={neon}
          toggleNeon={toggleNeon}
          onChangePassword={onChangePassword}"""),
]
for a, b in pairs:
    if s.count(a) != 1:
        sys.exit('Sidebar.tsx looks different than expected')
    s = s.replace(a, b)
open(p, 'w').write(s)
