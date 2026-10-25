<div align="center">

# 🎮 OVHcloud Game Panel

> **This fork** adds tools for **Call of Duty 4 (CoD4X)** and **B3**. Instructions are right below, details in [cod4/README.md](cod4/README.md).


### Deploy and manage your game servers in minutes — from one clean, modern web interface.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-Linux-1793D1)
[![Made by OVHcloud](https://img.shields.io/badge/Made%20by-OVHcloud-000e9c)](https://www.ovhcloud.com/)

<img src="docs/assets/game-panel.png" alt="OVHcloud Game Panel" width="900">

</div>

<br>

## 🔫 Call of Duty 4 (CoD4X) + B3: how to use

Additions for CoD4 servers installed through LinuxGSM (Game Panel 1.6.0). Everything was built and tested on **Ubuntu 24.04**.

### What you get

| Where in the panel | What |
|---|---|
| Server → **Settings → Game config → Command line** | Slots, `sv_authtoken`, Materials / Xanims / Xmodels, mod (`fs_game`), `rcon_password`. Nothing is written to `server.cfg`, and the RCON password works even if `server.cfg` has its own. |
| Server → **Settings → Game config → B3 (BigBrotherBot)** | Install / Start / Stop / Restart / Uninstall, console, `b3.xml` editor, logs. |
| **Installing a new CoD4 server** | a **Slots** field; the game files are copied from one of your servers instead of downloaded; no GitHub update check at every start. |
| `https://<panel domain>/pma/` | **phpMyAdmin** for the B3 database (MariaDB). |
| Sidebar → **✨** next to the light/dark button | **Neon** theme: animated aurora lights and grid, glass cards, neon edges and buttons (stops for reduced motion). |

### Install (on the panel server, as root)

```bash
cd ~
for f in gp-cod4-cmdline.sh gp-b3.sh gp-cod4-template.sh gp-pma.sh gp-db-root.sh gp-neon-theme.sh; do
  curl -fsSLO https://raw.githubusercontent.com/ProGameCro/game-panel/main/cod4/install/$f
done

bash gp-cod4-cmdline.sh      # 1. Command line card
bash gp-b3.sh                # 2. B3 card + B3 + MariaDB database
bash gp-cod4-template.sh     # 3. Slots and faster start for new CoD4 servers
bash gp-pma.sh               # 4. (optional) phpMyAdmin
bash gp-neon-theme.sh        # 5. (optional) Neon theme
```

Then reload the panel in the browser with **Ctrl+Shift+R**. All scripts can be run again, and **after every panel update** run 1–3 again.

### B3 step by step

1. In the **Command line** card set `rcon_password` (or *Generate*) → **Save** → restart the server.
2. In the **B3** card press **Install B3**: B3 is unpacked into the server folder `b3/` and `b3/b3/conf/b3.xml` is created with the RCON password, port, game log and database.
3. Press **Start B3**, join the server and type **`!iamgod`** (you become Super Admin).

- Config: card → **Edit b3/b3/conf/b3.xml** → *Save and restart B3*.
- Plugins: `b3/b3/extplugins`, plugin configs: `b3/b3/conf` (file manager).
- Parser **`cod4x18`** works without the b3hide plugin; if the server loads b3hide, `cod4x` works too.
- B3 sees the server folder as `/data` (e.g. `game_log: /data/serverfiles/main/games_mp.log`).

### Template for new CoD4 servers

```bash
bash ~/gp-cod4-template.sh       # list your CoD4 servers
bash ~/gp-cod4-template.sh 5     # server 5's files become the template
```

Every new CoD4 server then gets these files (CoD4X, mods, maps) right away, without downloading. Run it again after changing mods or maps.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Bad rcon` in the server console | the same password must be in the Command line card and in `b3.xml` (*Write these values into …*), then restart the server and B3. |
| `!iamgod` does nothing | the parser must be `cod4x18` (or `cod4x` with the b3hide plugin); B3 must be running before you type the command. |
| root login fails in phpMyAdmin | `bash ~/gp-db-root.sh` |
| the panel shows an old card | Ctrl+Shift+R or a private window. |

Database and phpMyAdmin passwords: `cat /etc/gamepanel-b3/db.env /etc/gamepanel-b3/pma.env`.

<br>

OVHcloud Game Panel is an **open-source, self-hosted** control panel to deploy, run, and monitor your game servers — **without ever touching the command line**. Spin up a Minecraft, Counter-Strike 2, Hytale, Palworld, Project Zomboid, Rust, Valheim or Garry's Mod server in a few clicks, then manage its files, backups, player access, and performance from a single modern dashboard. 🚀

## ✨ Features

- 🎛️ Complete server lifecycle management (create, start, stop, restart…).
- 📊 Live status, logs, metrics, and installation tracking.
- 👥 Live player counts and online player lists.
- 🕹️ Interactive in-browser game console.
- 📁 Powerful built-in file manager.
- 💾 One-click backups and restores.
- 🧩 In-panel mods installation.
- ⏰ Flexible task scheduling.
- 🐳 Advanced container configuration.
- 🔐 Fine-grained user permissions.
- 📈 Real-time host monitoring.
- 💻 Integrated container terminal.
- 🔄 Built-in one-click panel updater.

## 🕹️ Supported games

**Natively supported**, ready to deploy with OVHcloud-maintained images:

- **Minecraft** — Java Edition, Paper, Fabric, NeoForge, Forge, and Bedrock Edition
- **Counter-Strike 2**
- **Hytale**
- **Palworld**
- **Project Zomboid**
- **Rust**
- **Valheim**
- **Garry's Mod**

**And many more.** Game Panel integrates the full [LinuxGSM](https://linuxgsm.com/servers/) library, giving you a huge catalogue of additional dedicated game servers out of the box.

Your game isn't listed? You can also **add any external Docker image** and run it straight from the panel. 🐳

## 🚀 Installation

### ⚡ Automatic — OVHcloud VPS or Dedicated Server (recommended)

Game Panel can be installed **automatically, in one click**, when you deploy an OVHcloud **VPS** or **Dedicated Server**. See the [installation guide](https://docs.ovhcloud.com/en/guides/bare-metal-cloud/virtual-private-servers/game-panel-install-on-vps).

### 🛠️ Manual installation

**Prerequisites:**

- a Linux machine running Debian 12/13 or Ubuntu 22.04 / 24.04 / 25.10 / 26.04;
- a domain name pointing to the machine's public IP address;
- shell access with administrative privileges.

Don't have the infrastructure yet? 🌐 [Domain name](https://www.ovhcloud.com/en-ie/domains/) · 🖥️ [VPS](https://www.ovhcloud.com/en-ie/vps/) · 🗄️ [Dedicated server](https://www.ovhcloud.com/en-ie/bare-metal/)

**Command to run:**

```bash
sudo apt install git
git clone https://github.com/ProGameCro/game-panel.git
cd game-panel
sudo bash ./deploy/install.sh
```

> This installs the panel from this fork, so the CoD4 **Command line** and **B3** cards are already in it. For B3 itself
> (image, MariaDB, service), slots and templates still run `gp-b3.sh` and `gp-cod4-template.sh` from
> [the CoD4 instructions](#-call-of-duty-4-cod4x--b3-how-to-use); they skip the panel parts that are already there.

During installation, you'll be prompted for:

- Domain name
- Admin password
- Admin username (optional, default: `admin`)
- Let's Encrypt email

Once installed, your panel is live at **`https://<your-domain>`** 🎉

> 📡 OVHcloud Game Panel sends usage telemetry by default. You can disable it at install with `--telemetry-disabled`. See [docs/TELEMETRY.md](docs/TELEMETRY.md).

## 🏗️ Architecture

Under the hood, a **React + Vite** frontend talks to a **Node.js** backend (Express, WebSocket, SQLite) that orchestrates the full server lifecycle — files, backups, permissions, metrics, and container configuration — through the **Docker** engine.

- `frontend/` — React and Vite user interface.
- `backend/` — Node.js, Express, WebSocket, and SQLite backend.
- `docker-images/` — OVHcloud game server images and operational images.
- `deploy/` — self-hosted installation and update scripts.

## 📚 Documentation & support

- 📋 [Changelog](CHANGELOG.md)
- 📡 [Telemetry](docs/TELEMETRY.md)
- 💬 [Contact OVHcloud support](https://www.ovhcloud.com/en/contact/)
- 🎮 [OVHcloud Discord](https://discord.gg/ovhcloud)

## 📄 License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).
