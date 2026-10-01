#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function replaceInFile(filePath, pattern, replacement) {
  const content = fs.readFileSync(filePath, 'utf8');
  const nextContent = content.replace(pattern, replacement);

  if (content === nextContent) {
    return false;
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function updateCargoLockVersion(filePath, packageName, nextVersion) {
  if (!fs.existsSync(filePath)) {
    return 'missing';
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const packagePattern = new RegExp(
    `(\\[\\[package\\]\\][\\s\\S]*?name = "${packageName}"\\r?\\nversion = ").*?(")`,
    'm'
  );
  const nextContent = content.replace(packagePattern, `$1${nextVersion}$2`);

  if (content === nextContent) {
    return 'unchanged';
  }

  fs.writeFileSync(filePath, nextContent, 'utf8');
  return 'updated';
}

const packageJson = readJson(packageJsonPath);
const version = packageJson.version;

// Accept SemVer prereleases (for example 1.5.0-beta1) as well as stable builds.
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
const invalidNumericPrerelease = versionMatch?.[4]?.split('.').some(part => /^0\d+$/.test(part));
if (!versionMatch || invalidNumericPrerelease) {
  console.error(`Invalid version in package.json: ${version}`);
  process.exit(1);
}

const tauriConfig = readJson(tauriConfigPath);
tauriConfig.version = version;
writeJson(tauriConfigPath, tauriConfig);

const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const cargoPackageNameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"$/m);

if (!cargoPackageNameMatch) {
  console.error('Could not find package name in src-tauri/Cargo.toml');
  process.exit(1);
}

const cargoPackageName = cargoPackageNameMatch[1];
const cargoTomlUpdated = replaceInFile(
  cargoTomlPath,
  /^version\s*=\s*".*"$/m,
  `version = "${version}"`
);
const cargoLockStatus = updateCargoLockVersion(cargoLockPath, cargoPackageName, version);

console.log(`Synchronized version ${version}`);
console.log(`- package.json`);
console.log(`- src-tauri/tauri.conf.json`);
console.log(`- src-tauri/Cargo.toml${cargoTomlUpdated ? '' : ' (already up to date)'}`);
console.log(
  `- src-tauri/Cargo.lock${
    cargoLockStatus === 'updated'
      ? ''
      : cargoLockStatus === 'missing'
        ? ' (not found)'
        : ' (already up to date)'
  }`
);
