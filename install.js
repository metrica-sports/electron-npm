#!/usr/bin/env node
const DOWNLOAD_URL = 'https://github.com/metrica-sports/electron-npm/releases/download'

const extract = require('extract-zip');

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const { version } = require('./package');

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('Skipping download of Electron binary because ELECTRON_SKIP_BINARY_DOWNLOAD is set');
  process.exit(0);
}

const platformPath = getPlatformPath();
const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(__dirname, 'dist');
const electronPath = path.join(distPath, platformPath);
console.log(`Paths:\n- distPath=${distPath}\n- platformPath=${platformPath}\n- electronPath=${electronPath}`);

if (isInstalled()) {
  console.log('Electron binary already installed, skipping download');
  process.exit(0);
}

const platform = process.env.npm_config_platform || process.platform;
let arch = process.env.npm_config_arch || process.arch;

if (platform === 'darwin' && process.platform === 'darwin' && arch === 'x64' &&
  process.env.npm_config_arch === undefined) {
  // When downloading for macOS ON macOS and we think we need x64 we should
  // check if we're running under rosetta and download the arm64 version if appropriate
  try {
    const output = childProcess.execSync('sysctl -in sysctl.proc_translated');
    if (output.toString().trim() === '1') {
      arch = 'arm64';
    }
  } catch {
    // Ignore failure
  }
}

console.log("Version " + version)
const cacheRoot = path.join(__dirname, '.electron');
// downloads if not cached
downloadArtifact({
  version,
  artifactName: 'electron',
  force: false,
  cacheRoot: cacheRoot,
  checksums: undefined,
  platform,
  arch
}).then(extractFile).catch(err => {
  console.error(err.stack);
  process.exit(1);
});


function downloadArtifact({ version, artifactName, force, cacheRoot, platform, arch }) {
    const fileName = `${artifactName}-v${version}-${platform}-${arch}.zip`;
    const targetPath = path.join(cacheRoot, fileName);

    // Your custom release URL (for example, GitHub Releases)
    const baseUrl = DOWNLOAD_URL + `/v${version}`;
    const fileUrl = `${baseUrl}/${fileName}`;

    if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot, { recursive: true });

    // If cached and not forced, use the existing file
    if (!force && fs.existsSync(targetPath)) {
      console.log(`Using cached ${fileName}`);
      return Promise.resolve(targetPath);
    }

    console.log(`Downloading ${fileUrl} ...`);

    const fileStream = fs.createWriteStream(targetPath);
    return downloadWithRedirects(fileUrl, targetPath, fileStream);
}

function downloadWithRedirects(url, targetPath, fileStream, redirectCount = 0) {
  const MAX_REDIRECTS = 10;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Handle redirects (3xx responses)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          fileStream.close();
          return fs.unlink(targetPath, () =>
            reject(new Error('Too many redirects while downloading.'))
          );
        }

        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;

        console.log(`Redirecting to ${redirectUrl}`);
        // Recursive call for redirect
        res.destroy();
        return downloadWithRedirects(redirectUrl, targetPath, fileStream, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      // Handle successful download
      if (res.statusCode === 200) {
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            console.log(`Downloaded to ${targetPath}`);
          });
          resolve(targetPath);
        });
        return;
      }

      // Handle all other error codes
      fs.unlink(targetPath, () => {
        console.error(`Download failed: ${res.statusCode} ${res.statusMessage}`);
      });
    }).on('error', (err) => {
      fs.unlink(targetPath, () => {
        console.error(`Network error: ${err.message}`);
      });
    });
  });
}


function isInstalled() {
  try {
    if (!fs.existsSync(path.join(__dirname, 'electron.d.ts'))) {
      return false;
    }

    if (fs.readFileSync(path.join(distPath, 'version'), 'utf-8').replace(/^v/, '') !== version) {
      return false;
    }

    if (fs.readFileSync(path.join(__dirname, 'path.txt'), 'utf-8') !== platformPath) {
      return false;
    }
  } catch {
    return false;
  }

  return fs.existsSync(electronPath);
}

// unzips and makes path.txt point at the correct executable
function extractFile(zipPath) {
  console.log('Extracting zip file ' + zipPath);

  return extract(zipPath, { dir: distPath }).then(() => {
    // If the zip contains an "electron.d.ts" file, move that up
    const srcTypeDefPath = path.join(distPath, 'electron.d.ts');
    const targetTypeDefPath = path.join(__dirname, 'electron.d.ts');
    const hasTypeDefinitions = fs.existsSync(srcTypeDefPath);
    if (hasTypeDefinitions) {
      fs.renameSync(srcTypeDefPath, targetTypeDefPath);
    }

    // Write a "path.txt" file.
    return fs.promises.writeFile(path.join(__dirname, 'path.txt'), platformPath);
  });
}

function getPlatformPath() {
  const platform = process.env.npm_config_platform || os.platform();

  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error('Electron builds are not available on platform: ' + platform);
  }
}
