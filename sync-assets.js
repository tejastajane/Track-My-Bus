const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const targetDir = path.join(rootDir, 'www');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const itemsToCopy = [
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'manifest.json',
  'qr_codes.html',
  'assets',
  'qr_codes',
  'audio_cache'
];

for (const item of itemsToCopy) {
  const src = path.join(rootDir, item);
  const dest = path.join(targetDir, item);
  if (fs.existsSync(src)) {
    copyRecursive(src, dest);
  }
}

console.log('Frontend assets synced to www/ successfully.');
