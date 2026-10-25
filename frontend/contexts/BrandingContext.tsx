import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { apiClient } from '../utils/api';

// Custom panel name (set by an admin) shown instead of the "OVHcloud Game Panel" logo.
const DEFAULT_TITLE = 'OVHcloud Game Panel';

interface BrandingContextValue {
  name: string | null;
  saveName: (name: string) => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue>({ name: null, saveName: async () => {} });

export function usePanelName() {
  return useContext(BrandingContext);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getBranding()
      .then((data) => setName(data?.name ?? null))
      .catch(() => setName(null));
  }, []);

  useEffect(() => {
    document.title = name || DEFAULT_TITLE;
  }, [name]);

  const saveName = useCallback(async (next: string) => {
    const data = await apiClient.setBranding(next);
    setName(data?.name ?? null);
  }, []);

  return <BrandingContext.Provider value={{ name, saveName }}>{children}</BrandingContext.Provider>;
}

/** The panel's logo, or its custom name as text when an admin has set one. */
export function PanelLogo({
  imgClassName,
  textClassName = '',
  imgStyle,
  onClick,
}: {
  imgClassName: string;
  textClassName?: string;
  imgStyle?: CSSProperties;
  onClick?: () => void;
}) {
  const { name } = usePanelName();
  if (name) {
    return (
      <span
        className={`gp-panel-name block select-none truncate text-center font-bold tracking-tight text-white ${onClick ? 'cursor-pointer' : ''} ${textClassName}`}
        title={name}
        onClick={onClick}
      >
        {name}
      </span>
    );
  }
  return (
    <img
      src="/OVHcloud_Game_Panel_Logo.png"
      alt={DEFAULT_TITLE}
      draggable={false}
      className={imgClassName}
      style={imgStyle}
      onClick={onClick}
    />
  );
}
