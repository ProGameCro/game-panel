import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
// animated Neon theme on top of the dark theme, in two colour sets
export type NeonColor = 'off' | 'cyan' | 'orange';

interface ThemeContextValue {
  // 'dark' also while the neon theme is on
  theme: Theme;
  toggleTheme: () => void;
  neon: NeonColor;
  // off → cyan → orange → off
  toggleNeon: () => void;
  // the login page is always shown in the Neon theme (orange when Neon is off)
  setLoginScreen: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
  neon: 'off',
  toggleNeon: () => {},
  setLoginScreen: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

// orange Neon until someone picks another theme (also on the login page)
function getInitialNeon(): NeonColor {
  const stored = localStorage.getItem('theme-neon');
  if (stored === 'off') return 'off';
  return stored === '1' || stored === 'cyan' ? 'cyan' : 'orange';
}

const NEXT_NEON: Record<NeonColor, NeonColor> = { off: 'cyan', cyan: 'orange', orange: 'off' };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [neon, setNeon] = useState<NeonColor>(getInitialNeon);
  const [loginScreen, setLoginScreen] = useState(false);
  // what is shown: the login page uses orange Neon when Neon is off; the saved choice stays as it is
  const shownNeon: NeonColor = neon === 'off' && loginScreen ? 'orange' : neon;
  const effectiveTheme: Theme = shownNeon !== 'off' ? 'dark' : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.classList.toggle('gp-neon', shownNeon !== 'off');
    root.classList.toggle('gp-neon-orange', shownNeon === 'orange');
    localStorage.setItem('theme', theme);
    localStorage.setItem('theme-neon', neon);
  }, [effectiveTheme, theme, neon, shownNeon]);

  const toggleTheme = () => {
    // leaving dark (also from neon) goes to the light theme
    if (effectiveTheme === 'dark') {
      setNeon('off');
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };
  const toggleNeon = () => setNeon((prev) => NEXT_NEON[prev]);

  return (
    <ThemeContext.Provider value={{ theme: effectiveTheme, toggleTheme, neon, toggleNeon, setLoginScreen }}>
      {children}
    </ThemeContext.Provider>
  );
}
