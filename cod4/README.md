# Call of Duty 4 (CoD4X) + B3 for the OVHcloud Game Panel

Additions for the [OVHcloud Game Panel](https://github.com/ovh/game-panel) (version 1.6.0) for Call of Duty 4 servers
installed through LinuxGSM. Everything was built and tested on **Ubuntu 24.04**.

- **Command line card** (Settings > Game config): slots, `sv_authtoken`, Materials / Xanims / Xmodels (`r_xassetnum`),
  `fs_game` (mod), `rcon_password`. Nothing is written to `server.cfg`; the RCON password is set after `server.cfg`, so it wins.
- **B3 (BigBrotherBot) card**: Install / Start / Stop / Restart / Uninstall, live console, config editor, logs.
  B3 runs in its own Docker container next to the game server, from the server folder `b3/`, with a MariaDB database.
- **New CoD4 servers** are installed from the folder `/opt/gamepanel/cod4-linux` (hard links, no extra disk space) with a
  local image (`gamepanel-local/cod4`, built from `linuxgsm/`), so nothing is downloaded, not even LinuxGSM from GitHub.
  The install form checks the folder first and has a *Slots* field.
- **phpMyAdmin** for the B3 database at `https://<panel domain>/pma/`.
- **FastDL** for mods and maps, one per server: `/var/www/html/cod4/<server>` at `http://<panel domain>:8080/cod4/<server>`, synced by the service `gamepanel-fastdl`, on for new servers.
- **Neon theme**: an animated theme (aurora lights, moving grid, glass cards) in cyan or orange, switched with the ✨ button in the sidebar.
- **Panel name**: admins can replace the *OVHcloud Game Panel* logo with their own name (user menu ⋮ → Panel name).

## Install (on the panel server, as root)

Run the scripts from `install/` in this order (each one is safe to run again, also after a panel update):

```bash
bash gp-cod4-cmdline.sh      # Command line card
bash gp-b3.sh                # B3 card, B3 image, B3 service, MariaDB
bash gp-cod4-linux.sh        # new CoD4 servers from /opt/gamepanel/cod4-linux, local image, Slots
bash gp-cod4-linux.sh 5      # optional: fill /opt/gamepanel/cod4-linux with server 5's files
bash gp-cod4-linux.sh --pack # optional: pack the folder (parts of max 1.9 GB) to keep it in a PRIVATE place
bash gp-cod4-linux.sh --from <release page or links>   # after a reinstall: fill the folder from those parts
bash gp-pma.sh               # optional: phpMyAdmin at https://<panel domain>/pma/
bash gp-db-root.sh           # only if the MariaDB root login does not work
bash gp-neon-theme.sh        # optional: Neon theme and panel name
bash gp-fastdl.sh            # optional: FastDL for mods and maps (port 8080)
```

Then reload the panel (Ctrl+Shift+R) and open a CoD4 server > Settings > Game config.

## B3

- *Install B3* unpacks the bundled B3 (`b3/big-brother-bot-master.zip`: B3 1.12 with the `cod4x` parser) into the server
  folder `b3/` and writes `b3/b3/conf/b3.xml` with the server's RCON password, port, game log and database.
- Parser `cod4x18` (`b3/cod4x18.py`) is the `cod4x` parser for CoD4X servers **without** the b3hide plugin: it reads the
  players from the server's own `status` command instead of `b3status`. With the b3hide plugin loaded, `cod4x` works too.
- New databases are filled from `b3/b3-complete-ebc.sql`.
- Inside the B3 container the server folder is `/data` (same paths as the panel's file manager).

## Repository layout

| Folder | Content |
|---|---|
| `install/` | the installer scripts (all files embedded, nothing else needed) |
| `b3/` | B3 Docker image (Dockerfile, entrypoint), host service `gp-b3d.py`, `cod4x18.py`, B3 zip, database schema |
| `linuxgsm/` | the local CoD4 image: Dockerfile and the replaced `check_gamedig.sh` (no npm / GitHub at every start) |
| `tools/` | `make-gp-b3.sh`, `make-gp-cod4-linux.py` and `make-gp-neon-theme.py` rebuild the installers from this repository's sources; `patches/` are the small edits the installers apply to the panel |

The panel changes themselves are the commits of this fork (frontend `components/serverSettings/Cod4ModSection.tsx`,
`B3Section.tsx`, backend `providers/linuxgsm/adapters/cod4`).

## Licenses

- OVHcloud Game Panel: Apache License 2.0 (this fork and the files the installers add to the panel).
- BigBrotherBot (B3): GNU General Public License v2 (`b3/big-brother-bot-master.zip`, `b3/cod4x18.py`).
