# 🆓 Use DevAgent Completely for FREE (Puter.js Guide)

This guide explains how to run DevAgent completely for free and without limits using **Claude Sonnet 4.6** via the **Puter.js** interface.

You **do not need an official Anthropic API key** (`sk-ant-...`) and you don't need to purchase any API credits!

---

## ⚠️ CRITICAL NOTICE BEFORE YOU START

Since you are running this tool in your terminal (Node.js) rather than a web browser, you must provide DevAgent with a free Puter Auth Token to authorize your requests. **Without this step, the tool will immediately crash with an unauthorized error!**

---

## 🛠️ Step-by-Step Setup Guide

### 1. Install the Puter library in your project

Open your terminal in the project directory and install the official Puter extension:

```bash
npm install @heyputer/puter.js
```

### 2. Get your free Puter Token

1. Create a free account on [puter.com](https://puter.com) (or log in if you already have one).
2. Go to your Puter Dashboard and generate a JWT Auth Token (API Key). This token authenticates your terminal sessions.

### 3. Set the environment variable in your terminal

Before launching DevAgent, you need to store your token in your terminal environment. Copy the appropriate command for your operating system:

🪟 **Windows (Command Prompt / CMD):**
```cmd
set PUTER_AUTH_TOKEN=YOUR_JWT_TOKEN_HERE
```

🍎 **macOS / Linux / Git Bash:**
```bash
export PUTER_AUTH_TOKEN="YOUR_JWT_TOKEN_HERE"
```

🟦 **Windows (PowerShell):**
```powershell
$env:PUTER_AUTH_TOKEN="YOUR_JWT_TOKEN_HERE"
```

### 4. Launch DevAgent! 🚀

Now you can start the tool as usual:

```bash
da
```

Your DevAgent will now route all requests anonymously and completely free of charge through the Puter SDK to Claude Sonnet 4.6!

---

## 💡 Pro Tip for Power Users

To avoid typing or pasting your token every time you open a new terminal window, add the `PUTER_AUTH_TOKEN` variable permanently to your **System Environment Variables** (Windows) or your shell configuration file like `~/.bashrc` or `~/.zshrc` (Mac/Linux)!
