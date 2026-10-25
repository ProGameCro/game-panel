import sys
p = sys.argv[1]
s = open(p).read()
if 'a path ending with "/" is a folder' in s:
    sys.exit(0)
old = "            onOpenFileManagerPath={(path) => { hasUserSelectedTabRef.current = true; handleOpenFileManagerAtPath(path); }}\n"
if old not in s:
    sys.exit('ServerSettingsModal.tsx looks different than expected')
s = s.replace(old, """            onOpenFileManagerPath={(path) => {
              hasUserSelectedTabRef.current = true;
              // a path ending with "/" is a folder: show it in the file manager instead of opening it as a file
              if (path.endsWith('/')) {
                setSelectedFile(null);
                setCurrentPath(`/${path.replace(/^\\/+|\\/+$/g, '')}`);
                setActiveTab('filemanager');
                return;
              }
              handleOpenFileManagerAtPath(path);
            }}
""", 1)
open(p, 'w').write(s)
