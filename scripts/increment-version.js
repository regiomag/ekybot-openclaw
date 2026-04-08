#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const versionFile = path.join(__dirname, '../apps/web/src/config/version.ts');

// Lire le fichier de version
const content = fs.readFileSync(versionFile, 'utf8');

// Extraire la version actuelle
const match = content.match(/export const APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/);

if (!match) {
  console.error('Version format not found!');
  process.exit(1);
}

const [, major, minor, patch] = match;
const newPatch = parseInt(patch) + 1;
const newVersion = `v${major}.${minor}.${newPatch}`;

// Mettre à jour le fichier
const newContent = content.replace(
  /export const APP_VERSION = 'v\d+\.\d+\.\d+'/,
  `export const APP_VERSION = '${newVersion}'`
);

fs.writeFileSync(versionFile, newContent);

console.log(`Version updated: v${major}.${minor}.${patch} → ${newVersion}`);

// Retourner la nouvelle version pour utilisation dans d'autres scripts
process.stdout.write(newVersion);