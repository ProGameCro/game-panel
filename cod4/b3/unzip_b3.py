# extracts the B3 zip into b3src/ (the folder that holds b3_run.py, also when the zip has a top folder)
import os, shutil, sys, zipfile
zip_path, out = sys.argv[1], sys.argv[2]
tmp = out + '.tmp'
shutil.rmtree(tmp, ignore_errors=True)
with zipfile.ZipFile(zip_path) as z:
    for name in z.namelist():
        if name.startswith('/') or '..' in name.split('/'):
            sys.exit('unsafe path in zip: ' + name)
    z.extractall(tmp)
root = next((d for d, _, files in os.walk(tmp) if 'b3_run.py' in files), None)
if not root:
    sys.exit('no b3_run.py in the zip')
shutil.rmtree(out, ignore_errors=True)
shutil.move(root, out)
shutil.rmtree(tmp, ignore_errors=True)
