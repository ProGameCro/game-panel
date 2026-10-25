import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  // 'dark' also while the neon theme is on: neon is an animated layer on top of the dark theme
  theme: Theme;
  toggleTheme: () => void;
  neon: boolean;
  toggleNeon: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
  neon: false,
  toggleNeon: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

function getInitialNeon(): boolean {
  return localStorage.getItem('theme-neon') === '1';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [neon, setNeon] = useState<boolean>(getInitialNeon);
  const effectiveTheme: Theme = neon ? 'dark' : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.classList.toggle('gp-neon', neon);
    localStorage.setItem('theme', theme);
    localStorage.setItem('theme-neon', neon ? '1' : '0');
  }, [effectiveTheme, theme, neon]);

  const toggleTheme = () => {
    // leaving dark (also from neon) goes to the light theme
    if (effectiveTheme === 'dark') {
      setNeon(false);
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };
  const toggleNeon = () => setNeon((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ theme: effectiveTheme, toggleTheme, neon, toggleNeon }}>
      {children}
    </ThemeContext.Provider>
  );
}
