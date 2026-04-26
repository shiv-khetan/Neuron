const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const sourcePath = path.join(root, 'build', 'icon.svg');
const outputPath = path.join(root, 'build', 'icon.png');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true
    }
  });

  const iconSvg = fs.readFileSync(sourcePath, 'utf8');
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
        width: 512px;
        height: 512px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .icon-card {
        width: 450px;
        height: 450px;
        background: #000000;
        border-radius: 96px;
        display: flex;
        justify-content: center;
        align-items: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      svg {
        width: 400px;
        height: 400px;
        color: #ffffff;
        filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.85)) drop-shadow(0 0 8px rgba(255, 255, 255, 0.4));
      }
    </style>
    </head>
    <body>
      <div class="icon-card">
        ${iconSvg}
      </div>
    </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  win.webContents.once('did-finish-load', () => {
    // Wait a brief moment to ensure rendering and filters are fully applied
    setTimeout(async () => {
      try {
        const image = await win.capturePage();
        const pngBuffer = image.toPNG();

        fs.writeFileSync(outputPath, pngBuffer);
        console.log(`Generated ${path.relative(root, outputPath)}`);
        app.quit();
      } catch (err) {
        console.error('Failed to capture page:', err);
        app.exit(1);
      }
    }, 500);
  });
});
