#!/usr/bin/env node
'use strict';

/* Postinstall-Check: prueft, ob native Module ladbar sind.
 * Bricht den npm-install NICHT ab, gibt nur klare Warnungen aus.
 */

const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const abi = process.versions.modules;

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function info(msg) {
  process.stdout.write(`${C.cyan}[check-native]${C.reset} ${msg}\n`);
}
function warn(msg) {
  process.stdout.write(`${C.yellow}[check-native]${C.reset} ${msg}\n`);
}
function ok(msg) {
  process.stdout.write(`${C.green}[check-native]${C.reset} ${msg}\n`);
}
function fail(msg) {
  process.stdout.write(`${C.red}[check-native]${C.reset} ${msg}\n`);
}

function checkBetterSqlite3() {
  const pkgRoot = path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(pkgRoot)) {
    warn(
      'better-sqlite3 ist nicht installiert (node_modules fehlt). Bitte "npm install" ausfuehren.'
    );
    return false;
  }

  try {
    require('better-sqlite3');
    ok(`better-sqlite3 laedt korrekt (Node ${process.versions.node}, ABI ${abi}).`);
    return true;
  } catch (err) {
    fail(`better-sqlite3 konnte nicht geladen werden: ${err.message.split('\n')[0]}`);
    printRecoveryInstructions();
    return false;
  }
}

function printRecoveryInstructions() {
  const bold = (s) => `${C.bold}${s}${C.reset}`;
  process.stdout.write('\n');
  process.stdout.write(
    `${C.yellow}${bold('==== Reparatur-Anleitung better-sqlite3 ====')}${C.reset}\n`
  );
  process.stdout.write(
    `Plattform: ${process.platform} ${process.arch}, Node v${process.versions.node} (ABI ${abi})\n\n`
  );

  process.stdout.write(`${bold('Option 1 — Neuinstallation (am einfachsten):')}\n`);
  if (isWin) {
    process.stdout.write('   rmdir /s /q node_modules\n');
    process.stdout.write('   del package-lock.json\n');
  } else {
    process.stdout.write('   rm -rf node_modules package-lock.json\n');
  }
  process.stdout.write('   npm install\n\n');

  process.stdout.write(`${bold('Option 2 — Aus Quellcode bauen (braucht Build-Tools):')}\n`);
  process.stdout.write('   npm run fix-sqlite\n');
  if (isWin) {
    process.stdout.write(`   ${C.cyan}Windows-Voraussetzungen:${C.reset}\n`);
    process.stdout.write(
      '   • Visual Studio Build Tools 2022 (Workload "Desktop development with C++")\n'
    );
    process.stdout.write('     https://visualstudio.microsoft.com/visual-cpp-build-tools/\n');
    process.stdout.write('   • Python 3.x (https://www.python.org/downloads/)\n');
    process.stdout.write('   • Nach Installation: npm config set msvs_version 2022\n');
  } else if (isMac) {
    process.stdout.write(`   ${C.cyan}macOS-Voraussetzungen:${C.reset} xcode-select --install\n`);
  } else {
    process.stdout.write(`   ${C.cyan}Linux-Voraussetzungen:${C.reset} build-essential, python3\n`);
  }
  process.stdout.write('\n');

  process.stdout.write(`${bold('Option 3 — Node-Version pruefen:')}\n`);
  if (nodeMajor < 20) {
    process.stdout.write(
      `   Node v${process.versions.node} ist zu alt. Mindestens Node 20 LTS noetig.\n`
    );
  } else if (nodeMajor >= 26) {
    process.stdout.write(
      `   Node v${process.versions.node} ist sehr neu. Falls native Modules fehlen, auf Node 22 LTS wechseln.\n`
    );
  } else {
    process.stdout.write(`   Node v${process.versions.node} ist unterstuetzt.\n`);
  }
  process.stdout.write('\n');

  process.stdout.write(`${bold('Diagnose ausfuehren:')}\n   npm run doctor\n\n`);
}

if (require.main === module) {
  info(
    `Pruefe native Module auf ${process.platform}-${process.arch}, Node v${process.versions.node}...`
  );
  const okSqlite = checkBetterSqlite3();
  if (!okSqlite) {
    process.stdout.write(
      `\n${C.yellow}Hinweis: Der Fehler ist nicht-kritisch — npm install wird fortgesetzt.\n`
    );
    process.stdout.write(
      `Bevor "npm start" laeuft, muss obiger Fehler behoben sein.${C.reset}\n\n`
    );
  }
  process.exit(0);
}

module.exports = { checkBetterSqlite3, printRecoveryInstructions };
