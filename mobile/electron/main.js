const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

// In a checkout the Expo export sits next to this folder; in a packaged build
// electron-builder places it at resources/app/web.
const WEB_ROOT = fs.existsSync(path.join(__dirname, "web"))
  ? path.join(__dirname, "web")
  : path.join(__dirname, "..", "dist");

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * The bundle is served over http rather than loaded from `file://` for two reasons:
 * the export's asset URLs are absolute (`/_expo/...`), and `localStorage` — where the
 * server address is kept — is unreliable on a file origin.
 */
function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = url.pathname.replace(/^\//, "") || "index.html";
    let file = path.join(WEB_ROOT, relative);

    // Expo exports a single-page app, so unknown paths are routes, not missing files.
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(WEB_ROOT, "index.html");
    }

    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await serve();

  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 480,
    backgroundColor: "#0a0a0a",
    title: "min-agent",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Links to anywhere else belong in the user's browser, not in this window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await window.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
