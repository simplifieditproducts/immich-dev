import fs from 'fs';
import path from 'path';

// This script patches the immich-ui logo in the web project.
const oldLogoPath = path.resolve(__dirname, "./node_modules/@immich/ui/dist/assets/immich-logo.svg");
let newLogoPath = path.resolve(__dirname, "./static/logo.svg");
if (!fs.existsSync(newLogoPath)) {
  console.error("❌ immich-ui's new logo was not found at", newLogoPath);
  process.exit(1);
}
fs.copyFileSync(newLogoPath, oldLogoPath);
console.log("✅ immich-ui's logo has been patched!");
