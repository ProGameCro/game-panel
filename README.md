<div align="center">

# 🎮 OVHcloud Game Panel

> **Ovaj fork** dodaje alate za **Call of Duty 4 (CoD4X)** i **B3**. Upute su odmah ispod, detalji u [cod4/README.md](cod4/README.md).


### Deploy and manage your game servers in minutes — from one clean, modern web interface.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-Linux-1793D1)
[![Made by OVHcloud](https://img.shields.io/badge/Made%20by-OVHcloud-000e9c)](https://www.ovhcloud.com/)

<img src="docs/assets/game-panel.png" alt="OVHcloud Game Panel" width="900">

</div>

<br>

## 🔫 Call of Duty 4 (CoD4X) + B3: upute

Dodaci za CoD4 servere instalirane preko LinuxGSM-a (Game Panel 1.6.0).

### Što dobiješ

| Gdje u panelu | Što |
|---|---|
| Server → **Settings → Game config → Command line** | Slots, `sv_authtoken`, Materials / Xanims / Xmodels, mod (`fs_game`), `rcon_password`. Ništa se ne upisuje u `server.cfg`, a RCON lozinka vrijedi i kad je `server.cfg` ima. |
| Server → **Settings → Game config → B3 (BigBrotherBot)** | Install / Start / Stop / Restart / Uninstall, konzola, uređivanje `b3.xml`, logovi. |
| **Instalacija novog CoD4 servera** | polje **Slots**; datoteke se kopiraju s tvog postojećeg servera umjesto skidanja; nema provjere update-a na GitHubu pri svakom startu. |
| `https://<domena panela>/pma/` | **phpMyAdmin** za B3 bazu (MariaDB). |

### Instalacija (na serveru gdje je panel, kao root)

```bash
cd ~
for f in gp-cod4-cmdline.sh gp-b3.sh gp-cod4-template.sh gp-pma.sh gp-db-root.sh; do
  curl -fsSLO https://raw.githubusercontent.com/ProGameCro/game-panel/main/cod4/install/$f
done

bash gp-cod4-cmdline.sh      # 1. Command line kartica
bash gp-b3.sh                # 2. B3 kartica + B3 + MariaDB baza
bash gp-cod4-template.sh     # 3. Slots i brži start za nove CoD4 servere
bash gp-pma.sh               # 4. (po želji) phpMyAdmin
```

Zatim u pregledniku **Ctrl+Shift+R** na panelu. Sve skripte se smiju pokretati ponovno, a **nakon svake nadogradnje panela** ponovno pokreni 1–3.

### B3 korak po korak

1. U **Command line** kartici upiši `rcon_password` (ili *Generate*) → **Save** → restartaj server.
2. U **B3** kartici **Install B3**: B3 se raspakira u folder servera `b3/`, a `b3/b3/conf/b3.xml` se napravi s RCON lozinkom, portom, game logom i bazom.
3. **Start B3**, uđi na server i napiši **`!iamgod`** (postaješ Super Admin).

- Config: kartica → **Edit b3/b3/conf/b3.xml** → *Save and restart B3*.
- Pluginovi: `b3/b3/extplugins`, plugin configovi: `b3/b3/conf` (File manager).
- Parser **`cod4x18`** radi bez plugina b3hide; ako server učitava b3hide, može i `cod4x`.
- B3 vidi folder servera kao `/data` (npr. `game_log: /data/serverfiles/main/games_mp.log`).

### Predložak za nove CoD4 servere

```bash
bash ~/gp-cod4-template.sh       # popis tvojih CoD4 servera
bash ~/gp-cod4-template.sh 5     # datoteke servera 5 postaju predložak
```

Svaki novi CoD4 server tada odmah dobije te datoteke (CoD4X, modovi, mape) bez skidanja. Nakon promjene modova ili mapa pokreni ponovno.

### Kad nešto ne radi

| Problem | Rješenje |
|---|---|
| `Bad rcon` u konzoli servera | ista lozinka mora biti u Command line kartici i u `b3.xml` (*Write these values into …*), pa restart servera i B3. |
| `!iamgod` ne radi | parser mora biti `cod4x18` (ili `cod4x` uz plugin b3hide); B3 mora raditi prije nego napišeš naredbu. |
| ne radi root u phpMyAdminu | `bash ~/gp-db-root.sh` |
| panel pokazuje staru karticu | Ctrl+Shift+R ili privatni prozor. |

Lozinke baze i phpMyAdmina: `cat /etc/gamepanel-b3/db.env /etc/gamepanel-b3/pma.env`.

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
git clone https://github.com/ovh/game-panel.git
cd game-panel
sudo bash ./deploy/install.sh
```

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
