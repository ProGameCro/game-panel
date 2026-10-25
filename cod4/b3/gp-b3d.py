#!/usr/bin/env python3
"""B3 (BigBrotherBot) service for the OVHcloud Game Panel.

Every game server folder that has a b3/ folder (created by the panel's B3 card) gets its own B3 container.
The panel talks to this service through two files in that folder (readable and writable with the panel's file API):
  b3/control.json  written by the panel: {"action": "start" | "stop" | "restart", "id": "<unique id>"}
  b3/status.json   written here: state of the container, heartbeat and the database B3 can use
The container sees the server folder as /data (same paths as the panel's file manager), uses the host network
(RCON on 127.0.0.1) and runs as the owner of the server files.
"""
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time

SERVERS = os.environ.get('GP_SERVERS_DIR', '/opt/gamepanel/servers')
IMAGE = os.environ.get('GP_B3_IMAGE', 'gamepanel-b3:1.12')
STATE_DIR = os.environ.get('GP_B3_STATE', '/var/lib/gamepanel-b3')
DB_ENV = os.environ.get('GP_B3_DB_ENV', '/etc/gamepanel-b3/db.env')
DB_CONTAINER = 'gamepanel-b3-db'
# complete B3 schema (with the mod's player_core / prestige_log tables) imported into every new, empty database
SCHEMA = os.environ.get('GP_B3_SCHEMA', '/usr/local/lib/gamepanel-b3/b3-complete-ebc.sql')
LABEL = 'org.gamepanel.b3.key'
POLL = 3
HEARTBEAT = 15
ACTIONS = ('install', 'start', 'stop', 'restart', 'uninstall')
# config path relative to b3/, e.g. conf/b3.ini or app/b3/conf/b3.xml (own B3 uploaded to b3/app)
CONFIG_PATH = re.compile(r'^[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(ini|xml)$')
# searched in this order when the panel names no config; app/*/ covers a B3 uploaded as a folder inside b3/app
DEFAULT_CONFIGS = ['b3/conf/b3.xml', 'b3/conf/b3.ini', 'app/b3/conf/b3.xml', 'app/b3/conf/b3.ini', 'app/*/b3/conf/b3.xml', 'app/*/b3/conf/b3.ini',
                   'conf/b3.xml', 'conf/b3.ini', 'b3.xml', 'b3.ini']


def log(msg):
    print(time.strftime('%F %T'), msg, flush=True)


def docker(*args, check=False):
    p = subprocess.run(['docker', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip() or 'docker %s failed' % args[0])
    return p


def read_env(path):
    values = {}
    try:
        with open(path) as f:
            for line in f:
                if '=' in line and not line.lstrip().startswith('#'):
                    k, v = line.rstrip('\n').split('=', 1)
                    values[k.strip()] = v.strip()
    except OSError:
        pass
    return values


def server_ip():
    # the address the host uses to reach the internet (its public IP on a normal VPS); no packet is sent
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('1.1.1.1', 80))
            return s.getsockname()[0]
    except OSError:
        return None


def container_name(key):
    return 'gamepanel-b3-' + re.sub(r'[^a-zA-Z0-9_.-]', '-', key)


def db_name(key):
    return ('b3_' + re.sub(r'[^A-Za-z0-9_]', '_', key))[:64]


def owner(path):
    st = os.stat(path)
    return st.st_uid, st.st_gid


def write_json(path, data, uid, gid):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    os.chown(tmp, uid, gid)
    os.chmod(tmp, 0o664)
    os.replace(tmp, path)


def chown_tree(path, uid, gid):
    for root, dirs, files in os.walk(path):
        for name in dirs + files:
            p = os.path.join(root, name)
            try:
                if not os.path.islink(p):
                    os.chown(p, uid, gid)
            except OSError:
                pass
    os.chown(path, uid, gid)


class Service:
    def __init__(self):
        os.makedirs(STATE_DIR, exist_ok=True)
        self.handled = self.load_state()
        self.last_status = {}
        self.last_write = {}
        self.ip = server_ip()

    def load_state(self):
        try:
            with open(os.path.join(STATE_DIR, 'handled.json')) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def save_state(self):
        with open(os.path.join(STATE_DIR, 'handled.json'), 'w') as f:
            json.dump(self.handled, f)

    # ---- database -------------------------------------------------------------------------------------------
    def database(self, key):
        env = read_env(DB_ENV)
        if not env.get('B3_DB_PASSWORD'):
            return None
        name = db_name(key)
        port = env.get('B3_DB_PORT', '3306')
        return {
            'host': '127.0.0.1', 'port': int(port), 'name': name, 'user': 'b3', 'password': env['B3_DB_PASSWORD'],
            'url': 'mysql://b3:%s@127.0.0.1%s/%s' % (env['B3_DB_PASSWORD'], '' if port == '3306' else ':' + port, name),
        }

    def ensure_database(self, key):
        env = read_env(DB_ENV)
        root = env.get('B3_DB_ROOT_PASSWORD')
        if not root:
            return
        name = db_name(key)
        sql = "CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8; GRANT ALL PRIVILEGES ON `%s`.* TO 'b3'@'%%';" % (name, name)
        p = docker('exec', '-e', 'MYSQL_PWD=' + root, DB_CONTAINER, 'mariadb', '-uroot', '-e', sql)
        if p.returncode != 0:
            raise RuntimeError('Database: ' + (p.stderr.strip() or 'could not create %s' % name))
        if not os.path.isfile(SCHEMA):
            return
        count = docker('exec', '-e', 'MYSQL_PWD=' + root, DB_CONTAINER, 'mariadb', '-uroot', '-N', '-e',
                       "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '%s';" % name)
        if count.returncode == 0 and count.stdout.strip() == '0':
            log('%s: importing %s' % (name, os.path.basename(SCHEMA)))
            with open(SCHEMA) as f:
                imp = subprocess.run(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + root, DB_CONTAINER, 'mariadb', '-uroot', name],
                                     stdin=f, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if imp.returncode != 0:
                raise RuntimeError('Database: importing %s failed: %s' % (os.path.basename(SCHEMA), imp.stderr.strip()[:300]))

    # ---- containers -----------------------------------------------------------------------------------------
    def inspect(self, key):
        p = docker('inspect', '--format', '{{json .State}}', container_name(key))
        if p.returncode != 0:
            return None
        try:
            return json.loads(p.stdout)
        except ValueError:
            return None

    def start(self, key, data_dir, request):
        b3 = os.path.join(data_dir, 'b3')
        config = request.get('config') or ''
        if config and (not CONFIG_PATH.match(config) or '..' in config.split('/')):
            raise RuntimeError('Invalid config file: %s' % config)
        # a bare file name is looked up in b3/ and then in b3/conf
        candidates = ([config] if '/' in config else [config, 'conf/' + config]) if config else DEFAULT_CONFIGS
        real_b3 = os.path.realpath(b3)
        paths = [os.path.relpath(m, b3) for c in candidates for m in sorted(glob.glob(os.path.join(b3, c)))]
        found = next((c for c in paths if os.path.isfile(os.path.join(b3, c))
                      and os.path.realpath(os.path.join(b3, c)).startswith(real_b3 + os.sep)), None)
        if not found:
            raise RuntimeError('No B3 config found (%s). Upload your B3 config first.' % ', '.join('b3/' + c for c in candidates))
        uid, gid = owner(data_dir)
        os.makedirs(os.path.join(b3, 'logs'), exist_ok=True)
        chown_tree(b3, uid, gid)
        self.ensure_database(key)
        docker('rm', '-f', container_name(key))
        docker('run', '-d', '--name', container_name(key), '--label', '%s=%s' % (LABEL, key),
               '--restart', 'unless-stopped', '--network', 'host', '--user', '%d:%d' % (uid, gid),
               '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2',
               '-e', 'B3_CONFIG=/data/b3/' + found, '-v', '%s:/data' % data_dir, IMAGE, check=True)

    def stop(self, key):
        docker('rm', '-f', container_name(key))

    def install(self, key, data_dir):
        # puts the bundled B3 (the user's big-brother-bot zip) straight into the server's b3 folder,
        # where it can be seen and edited and from where it runs (existing files are kept)
        b3 = os.path.join(data_dir, 'b3')
        if os.path.isfile(os.path.join(b3, 'b3_run.py')):
            return
        uid, gid = owner(data_dir)
        chown_tree(b3, uid, gid)
        docker('run', '--rm', '--user', '%d:%d' % (uid, gid), '--entrypoint', 'sh', '-v', '%s:/data' % data_dir, IMAGE,
               '-c', 'cp -an /opt/b3/. /data/b3/', check=True)
        self.ensure_database(key)

    def uninstall(self, key, data_dir, request):
        # stops B3 and removes the server's b3 folder; the database is kept unless the panel asks to drop it
        self.stop(key)
        if request.get('dropDatabase'):
            root = read_env(DB_ENV).get('B3_DB_ROOT_PASSWORD')
            if root:
                docker('exec', '-e', 'MYSQL_PWD=' + root, DB_CONTAINER, 'mariadb', '-uroot',
                       '-e', 'DROP DATABASE IF EXISTS `%s`;' % db_name(key))
        b3 = os.path.join(data_dir, 'b3')
        if os.path.isdir(b3) and not os.path.islink(b3):
            shutil.rmtree(b3)

    # ---- loop -----------------------------------------------------------------------------------------------
    def servers(self):
        found = {}
        try:
            names = os.listdir(SERVERS)
        except OSError:
            return found
        for name in names:
            data_dir = os.path.join(SERVERS, name, 'data')
            if os.path.isdir(os.path.join(data_dir, 'b3')) and not os.path.islink(os.path.join(data_dir, 'b3')):
                found[name] = data_dir
        return found

    def handle(self, key, data_dir):
        b3 = os.path.join(data_dir, 'b3')
        message = None
        last = self.handled.get(key) or {}
        try:
            with open(os.path.join(b3, 'control.json')) as f:
                request = json.load(f)
        except (OSError, ValueError):
            request = None
        if isinstance(request, dict) and request.get('id') and request.get('id') != last.get('id'):
            action = request.get('action')
            result = 'ok'
            try:
                if action not in ACTIONS:
                    raise RuntimeError('Unknown action: %s' % action)
                log('%s: %s' % (key, action))
                if action == 'uninstall':
                    self.uninstall(key, data_dir, request)
                    self.handled.pop(key, None)
                    self.last_status.pop(key, None)
                    self.save_state()
                    return
                if action == 'install':
                    self.install(key, data_dir)
                if action in ('stop', 'restart'):
                    self.stop(key)
                if action in ('start', 'restart'):
                    self.start(key, data_dir, request)
            except Exception as e:  # reported to the panel
                result = 'error'
                message = str(e)
                log('%s: %s failed: %s' % (key, action, message))
            last = {'id': request.get('id'), 'action': action, 'result': result, 'message': message, 'at': int(time.time())}
            self.handled[key] = last
            self.save_state()

        state = self.inspect(key)
        if state is None:
            status = 'stopped'
        elif state.get('Running'):
            status = 'running'
        elif state.get('Restarting'):
            status = 'restarting'
        else:
            status = 'exited'
        data = {
            'service': 'gamepanel-b3',
            'image': IMAGE,
            'state': status,
            'exitCode': None if state is None or status == 'running' else state.get('ExitCode'),
            'startedAt': state.get('StartedAt') if state else None,
            'lastAction': last or None,
            'database': self.database(key),
            'serverIp': self.ip,
        }
        now = time.time()
        if data != self.last_status.get(key) or now - self.last_write.get(key, 0) >= HEARTBEAT:
            data['heartbeat'] = int(now)
            uid, gid = owner(data_dir)
            write_json(os.path.join(b3, 'status.json'), data, uid, gid)
            self.last_status[key] = {k: v for k, v in data.items() if k != 'heartbeat'}
            self.last_write[key] = now

    def cleanup(self, keys):
        # forget requests of servers whose b3 folder was removed, so a new install starts clean
        gone = [key for key in self.handled if key not in keys]
        for key in gone:
            self.handled.pop(key, None)
        if gone:
            self.save_state()
        # B3 containers of servers whose b3 folder or whole server was deleted in the panel
        p = docker('ps', '-a', '--filter', 'label=' + LABEL, '--format', '{{.Label "%s"}}' % LABEL)
        for key in p.stdout.split():
            if key not in keys:
                log('%s: server folder is gone, removing its B3 container' % key)
                self.stop(key)

    def run(self):
        log('watching %s' % SERVERS)
        tick = 0
        while True:
            found = self.servers()
            for key, data_dir in found.items():
                try:
                    self.handle(key, data_dir)
                except Exception as e:
                    log('%s: %s' % (key, e))
            if tick % 20 == 0:
                self.cleanup(found)
            tick += 1
            if os.environ.get('GP_B3_ONCE'):
                return
            time.sleep(POLL)


if __name__ == '__main__':
    try:
        Service().run()
    except KeyboardInterrupt:
        sys.exit(0)
