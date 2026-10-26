interface ReleaseConfigKeyDefinition {
  title?: string | null;
  type?: string;
  options?: Array<string | { value?: string; label?: string }> | null;
  description?: string | null;
  section?: string | null;
  trueValue?: string | null;
  falseValue?: string | null;
  min?: number;
  max?: number;
  format?: ReleaseConfigKeyFormatDefinition | null;
}

interface ReleaseConfigKeyFormatDefinition {
  type?: string | null;
  step?: number | null;
  entrySeparator?: string | null;
  keyValueSeparator?: string | null;
  quoteKeys?: boolean | null;
  quoteValues?: boolean | null;
  spacesAroundSeparator?: boolean | null;
  commentPrefixes?: string[] | null;
}

interface ReleaseConfigFileFormatDefinition {
  type?: string;
  entrySeparator?: string | null;
  keyValueSeparator?: string | null;
  quoteKeys?: boolean | null;
  quoteValues?: boolean | null;
  spacesAroundSeparator?: boolean | null;
  commentPrefixes?: string[] | null;
}

export interface AdminOverview {
  servers: Array<{
    id: number;
    name: string;
    catalogId: string | null;
    status: string;
    desiredState: string | null;
    b3: { state: string; wanted: boolean; heartbeatAge: number | null } | null;
    fastdl: boolean | null;
  }>;
  fastdl: {
    installed: boolean;
    url?: string;
    browserUrl?: string | null;
    running?: boolean;
    lastSync?: number | null;
    serviceAlive?: boolean;
    published?: Record<string, number>;
  };
  system: {
    hostname: string;
    uptime: number;
    load: number[];
    cpus: number;
    memory: { total: number; free: number };
    disk: { total: number; free: number; used: number } | null;
    containers: Array<{ name: string; image: string; state: string; status: string; project: string | null }>;
    sizes: Record<string, number> | null;
  };
  alerts: Array<{ level: 'error' | 'warning'; text: string; serverId?: number }>;
}

export interface CatalogNewsItem {
  id: number;
  title: string;
  description: string;
  date: number;
  type: string | null;
  iconKey: string;
  position: number;
}

export interface CatalogResourceItem {
  id: number;
  title: string;
  description: string;
  url: string;
  category: string;
  mediaType: string;
  gameKey: string | null;
}

export interface ReleaseConfigFileDefinition {
  path?: string;
  format?: ReleaseConfigFileFormatDefinition | null;
  keys?: Record<string, ReleaseConfigKeyDefinition> | null;
}

