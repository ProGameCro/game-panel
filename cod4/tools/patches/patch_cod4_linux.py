"""Registers the CoD4 files status: /api/cod4 in the backend, apiClient.getCod4FilesStatus() in the frontend,
apiClient.setSuperAdmin() for the Super Admin button in User Administration, and the panel's own news (/api/news),
and the Admin page (/api/admin).
Small insertions (these files are also changed by other installers). Safe to run again. Usage: patch_cod4_linux.py <app>"""
import os, sys

app = sys.argv[1]

def insert(rel, marker, anchor, text, after=True):
    path = os.path.join(app, rel)
    s = open(path).read()
    if marker in s:
        return False
    if s.count(anchor) != 1:
        sys.exit('%s: unknown version (anchor not found). Nothing was changed.' % rel)
    s = s.replace(anchor, anchor + text if after else text + anchor)
    open(path, 'w').write(s)
    return True

changed = set()
# panel name (theme part, formerly gp-neon-theme.sh)
if insert('backend/src/index.ts', 'routes/branding.js', "import downloadRoutes from './routes/download.js';\n",
          "import brandingRoutes from './routes/branding.js';\n"):
    changed.add('backend')
if insert('backend/src/index.ts', "app.use('/api/branding'", "app.use('/api/download', downloadRoutes);\n",
          "// /api/branding (custom panel name; reading needs no login)\napp.use('/api/branding', brandingRoutes);\n"):
    changed.add('backend')
if insert('frontend/utils/api.ts', 'getBranding', '  async installServer(payload: {\n',
          "  // custom panel name (null = the OVHcloud logo); reading needs no login\n"
          "  async getBranding() {\n"
          "    const response = await this.client.get('/api/branding');\n"
          "    return response.data as { name: string | null };\n"
          "  }\n\n"
          "  async setBranding(name: string) {\n"
          "    const response = await this.client.put('/api/branding', { name });\n"
          "    return response.data as { name: string | null };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('backend/src/index.ts', "routes/cod4.js", "import downloadRoutes from './routes/download.js';\n",
          "import cod4Routes from './routes/cod4.js';\n"):
    changed.add('backend')
if insert('backend/src/index.ts', "app.use('/api/cod4'", "app.use('/api/catalog', authMiddleware, catalogRoutes);\n",
          "// /api/cod4 (Call of Duty 4: game files status)\napp.use('/api/cod4', cod4Routes);\n"):
    changed.add('backend')
if insert('frontend/utils/api.ts', 'getCod4FilesStatus', '  async getCurrentUser() {\n',
          "  // Call of Duty 4: are the cod4-linux folder and the local image ready for an install?\n"
          "  async getCod4FilesStatus() {\n"
          "    const response = await this.client.get('/api/cod4/files');\n"
          "    return response.data as Cod4FilesStatus;\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('frontend/utils/api.ts', 'export type Cod4FilesStatus', 'export const apiClient',
          "export type Cod4FilesStatus = { ready: boolean; folder: string; problems: string[] };\n\n", after=False):
    changed.add('frontend')
if insert('frontend/utils/api.ts', 'setSuperAdmin', '  async resetUserPassword(userId: number, newPassword: string) {\n',
          "  // make a user a Super Admin (full access) or take it back; only Super Admins may do this\n"
          "  async setSuperAdmin(userId: number, enabled: boolean) {\n"
          "    const response = await this.client.post(`/api/users/${userId}/super-admin`, { enabled });\n"
          "    return response.data as { success: boolean };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('backend/src/index.ts', "routes/news.js", "import downloadRoutes from './routes/download.js';\n",
          "import newsRoutes from './routes/news.js';\n"):
    changed.add('backend')
if insert('backend/src/index.ts', "app.use('/api/news'", "app.use('/api/catalog', authMiddleware, catalogRoutes);\n",
          "// /api/news (the news bar, written by the panel's admins)\napp.use('/api/news', newsRoutes);\n"):
    changed.add('backend')
if insert('frontend/utils/api.ts', 'getPanelNews', '  async getNews(limit?: number) {\n',
          "  // the news bar: this panel's own news (written by its Super Admins), not OVHcloud's catalog\n"
          "  async getPanelNews() {\n"
          "    const response = await this.client.get('/api/news');\n"
          "    return response.data as { news: import('./api/types').CatalogNewsItem[] };\n"
          "  }\n\n"
          "  async savePanelNews(news: Array<{ title: string; description: string; iconKey: string; date: number }>) {\n"
          "    const response = await this.client.put('/api/news', { news });\n"
          "    return response.data as { news: import('./api/types').CatalogNewsItem[] };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('frontend/utils/api.ts', 'getCod4FastDl', '  async getCod4FilesStatus() {\n',
          "  // FastDL (gp-fastdl.sh): URL, web server state and this server's published mods / maps\n"
          "  async getCod4FastDl(serverId: number) {\n"
          "    const response = await this.client.get(`/api/cod4/fastdl/${serverId}`);\n"
          "    return response.data as { installed: boolean; url: string | null; browserUrl?: string | null; running: boolean; files: Array<{ path: string; published: boolean }> };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('frontend/utils/api.ts', 'syncCod4FastDl', '  async getCod4FilesStatus() {\n',
          "  // FastDL \"Sync now\": the sync service publishes this server's mods / maps at once\n"
          "  async syncCod4FastDl(serverId: number) {\n"
          "    const response = await this.client.post(`/api/cod4/fastdl/${serverId}/sync`);\n"
          "    return response.data as { total: number; added: number; removed: number };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('backend/src/index.ts', "routes/admin.js", "import downloadRoutes from './routes/download.js';\n",
          "import adminRoutes from './routes/admin.js';\n"):
    changed.add('backend')
if insert('backend/src/index.ts', "app.use('/api/admin'", "app.use('/api/catalog', authMiddleware, catalogRoutes);\n",
          "// /api/admin (Admin page, Super Admins)\napp.use('/api/admin', adminRoutes);\n"):
    changed.add('backend')
if insert('frontend/utils/api.ts', 'getAdminOverview', '  async getCod4FilesStatus() {\n',
          "  // Admin page (Super Admins): add-ons, host and alerts; sizes=true also counts the folder sizes (slower)\n"
          "  async getAdminOverview(sizes = false) {\n"
          "    const response = await this.client.get('/api/admin/overview', { params: sizes ? { sizes: 1 } : {} });\n"
          "    return response.data as import('./api/types').AdminOverview;\n"
          "  }\n\n"
          "  async syncAllFastDl() {\n"
          "    const response = await this.client.post('/api/admin/fastdl/sync');\n"
          "    return response.data as { total: number; added: number; removed: number };\n"
          "  }\n\n", after=False):
    changed.add('frontend')
if insert('frontend/utils/api/types.ts', 'export interface AdminOverview', 'export interface CatalogNewsItem {',
          "export interface AdminOverview {\n"
          "  servers: Array<{\n"
          "    id: number;\n"
          "    name: string;\n"
          "    catalogId: string | null;\n"
          "    status: string;\n"
          "    desiredState: string | null;\n"
          "    b3: { state: string; wanted: boolean; heartbeatAge: number | null } | null;\n"
          "    fastdl: boolean | null;\n"
          "  }>;\n"
          "  fastdl: {\n"
          "    installed: boolean;\n"
          "    url?: string;\n"
          "    browserUrl?: string | null;\n"
          "    running?: boolean;\n"
          "    lastSync?: number | null;\n"
          "    serviceAlive?: boolean;\n"
          "    published?: Record<string, number>;\n"
          "  };\n"
          "  system: {\n"
          "    hostname: string;\n"
          "    uptime: number;\n"
          "    load: number[];\n"
          "    cpus: number;\n"
          "    memory: { total: number; free: number };\n"
          "    disk: { total: number; free: number; used: number } | null;\n"
          "    containers: Array<{ name: string; image: string; state: string; status: string; project: string | null }>;\n"
          "    sizes: Record<string, number> | null;\n"
          "  };\n"
          "  alerts: Array<{ level: 'error' | 'warning'; text: string; serverId?: number }>;\n"
          "}\n\n", after=False):
    changed.add('frontend')
print(' '.join(sorted(changed)))
