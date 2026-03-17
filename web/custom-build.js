import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));


const appId = process.env.VITE_APP_ID || 'picturekeeper';
const appName = appId === 'ultimatebackup' ? 'Ultimate Backup' : 'Picture Keeper';
console.log('Running custom build script with VITE_APP_ID:', appId);


/// 1. Copy the static files to the right location

// patch all the icon files.
if (appId !== 'picturekeeper') {
  let srcFolder = path.resolve(__dirname, `./static/${appId}`);
  let dstFolder = path.resolve(__dirname, './static');
  fs.readdirSync(srcFolder).forEach(file => {
    fs.copyFileSync(path.join(srcFolder, file), path.join(dstFolder, file));
  });

  srcFolder = path.resolve(__dirname, `./src/lib/assets/${appId}`);
  dstFolder = path.resolve(__dirname, './src/lib/assets');
  fs.readdirSync(srcFolder).forEach(file => {
    fs.copyFileSync(path.join(srcFolder, file), path.join(dstFolder, file));
  });
}
console.log("✅ static icons have been updated!");

// patch the immich-ui logo in the web project.
const oldLogoPath = path.resolve(__dirname, "./node_modules/@immich/ui/dist/assets/immich-logo.svg");
let newLogoPath = path.resolve(__dirname, "./static/logo.svg");
if (!fs.existsSync(newLogoPath)) {
  console.error("❌ immich-ui's new logo was not found at", newLogoPath);
  process.exit(1);
}
fs.copyFileSync(newLogoPath, oldLogoPath);
console.log("✅ immich-ui's logo has been updated!");

/// 2. Update the app.html file with the new app ID.

// Replace VITE_APP_ID in app.html so the data-app-id attribute is set at build time
const appHtmlPath = path.resolve(__dirname, './src/app.html');
let appHtml = fs.readFileSync(appHtmlPath, 'utf-8');
appHtml = appHtml.replaceAll('VITE_APP_ID', appId);
fs.writeFileSync(appHtmlPath, appHtml, 'utf-8');
console.log("✅ app.html has been updated with app ID:", appId);

/// 3. Update the text copies in i18n and configure files.

const filesToUpdate = [
  '../i18n/en.json',
  './static/manifest.json',
];
filesToUpdate.forEach(filePath => {
  const fullPath = path.resolve(__dirname, filePath);
  let content = fs.readFileSync(fullPath, 'utf-8');
  content = content.replaceAll(`"Immich"`, `"${appName}"`);
  content = content.replaceAll("Welcome to Immich", `Welcome to ${appName}`);
  fs.writeFileSync(fullPath, content, 'utf-8');
});
console.log("✅ i18n and manifest files have been updated!");