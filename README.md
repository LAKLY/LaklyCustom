<div align="center">

# LaklyCustom

### Share localhost in one click.

Turn any folder, port, or dev server into a public link — no deploy, no domain, no signup.

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Cloudflare](https://img.shields.io/badge/Tunnel-Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

[![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white)](#)
[![Status](https://img.shields.io/badge/Status-v0.8.0%20beta-orange?style=flat-square)](#)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-contributing)

[**Download**](#-quick-start) · [Features](#-what-it-does) · [Use cases](#-use-cases) · [Plugins](#-plugins-bonus) · [Roadmap](#-roadmap) · [Security](#-security)

</div>

---

<div align="center">

<p>
  <img src="./assets/readme/host.png" alt="Host UI" width="880">
</p>

<sub>Pick what to share · Get a public URL and QR in seconds</sub>

</div>

---

## ⚡ What it does

Three ways to share something from your machine with the world.

<table>
<tr>
<td width="33%" valign="top" align="center">

### 📁 Folder

<img src="https://img.shields.io/badge/1--click-ff6b6b?style=flat-square" alt="1 click">

**Share a folder of HTML.**
Point at `dist/`, `build/`, or any folder with an `index.html`. Get a public URL.

*Perfect for: prototypes, static sites, portfolio previews.*

</td>
<td width="33%" valign="top" align="center">

### 🔌 Port

<img src="https://img.shields.io/badge/1--click-ff6b6b?style=flat-square" alt="1 click">

**Publish `localhost:5173`.**
Vite, Next, Django, Flask — anything with HTTP. WebSocket support included.

*Perfect for: dev servers, APIs, dashboards.*

</td>
<td width="33%" valign="top" align="center">

### 🎮 Room

<img src="https://img.shields.io/badge/bonus-9b8cff?style=flat-square" alt="bonus">

**Or spin up a multiplayer room.**
Chat, players, and games with a tiny plugin API.

*Perfect for: quick multiplayer demos, mini-games.*

</td>
</tr>
</table>

<div align="center">

### 🚀 Public URL in seconds — no signup, no domain, no port forwarding

</div>

---

## 🎯 Use cases

Real things people do with LaklyCustom:

<table>
<tr>
<td width="50%" valign="top">

### 👨‍💻 Show a prototype to a client

```bash
npm run build
# → dist/ is ready
