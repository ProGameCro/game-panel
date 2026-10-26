"""Registers the CoD4 files status: /api/cod4 in the backend, apiClient.getCod4FilesStatus() in the frontend.
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
print(' '.join(sorted(changed)))
