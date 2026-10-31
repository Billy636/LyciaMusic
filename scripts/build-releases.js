import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const outputDir = path.join(rootDir, 'releases');

// Helper to read JSON
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Helper to write JSON
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to run a command and log output
function runCommand(command, cwd) {
  console.log(`Running: ${command}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

async function main() {
  // 1. Backup original tauri.conf.json
  const originalConfigContent = fs.readFileSync(tauriConfigPath, 'utf8');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Read version
    const packageJson = readJson(packageJsonPath);
    const version = packageJson.version;
    console.log(`Building Lycia Player v${version}...`);

    const buildTargets = [
      {
        type: 'skip',
        suffix: 'no-webview-check',
        label: '免检测安装版 (跳过 WebView2 检测)'
      },
      {
        type: 'downloadBootstrapper',
        suffix: 'standard',
        label: 'Standard标准版本 (检测并自动下载 WebView2)'
      }
    ];

    for (const target of buildTargets) {
      console.log(`\n==================================================`);
      console.log(`开始构建: ${target.label}`);
      console.log(`==================================================`);

      // Modify tauri.conf.json
      const config = JSON.parse(originalConfigContent);
      if (!config.bundle) {
        config.bundle = {};
      }
      if (!config.bundle.windows) {
        config.bundle.windows = {};
      }
      config.bundle.windows.webviewInstallMode = {
        type: target.type
      };
      config.bundle.targets = ["nsis"];
      writeJson(tauriConfigPath, config);

      // Clean old bundle output directory to avoid picking up old files
      const nsisDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
      if (fs.existsSync(nsisDir)) {
        console.log(`正在清理旧的打包输出: ${nsisDir}`);
        fs.rmSync(nsisDir, { recursive: true, force: true });
      }

      // Run tauri build
      runCommand('npm run tauri build', rootDir);

      // Locate the built installer in nsis directory
      if (!fs.existsSync(nsisDir)) {
        throw new Error(`找不到构建输出目录: ${nsisDir}`);
      }

      const files = fs.readdirSync(nsisDir);
      const exeFiles = files.filter(f => f.endsWith('.exe'));

      if (exeFiles.length === 0) {
        throw new Error(`在 ${nsisDir} 中未找到生成的 .exe 安装包`);
      }

      // We expect only one setup exe, but process all .exe found just in case
      for (const exeFile of exeFiles) {
        const srcPath = path.join(nsisDir, exeFile);
        
        // Target name formatting: replace spaces with dots, and append -suffix before .exe
        // e.g. "Lycia Player_1.3.8_x64-setup.exe" -> "Lycia.Player_1.3.8_x64-setup-portable.exe"
        let destName = exeFile.replace(/\s+/g, '.');
        if (destName.endsWith('-setup.exe')) {
          destName = destName.replace(/-setup\.exe$/, `-setup-${target.suffix}.exe`);
        } else {
          destName = destName.replace(/\.exe$/, `-${target.suffix}.exe`);
        }

        const destPath = path.join(outputDir, destName);
        console.log(`复制并重命名安装包:`);
        console.log(`  源文件: ${srcPath}`);
        console.log(`  目标文件: ${destPath}`);
        fs.copyFileSync(srcPath, destPath);
      }

      if (target.type === 'skip') {
        const staging = fs.mkdtempSync(path.join(outputDir, '.portable-'));
        try {
          fs.copyFileSync(
            path.join(rootDir, 'src-tauri', 'target', 'release', 'lycia_music.exe'),
            path.join(staging, 'Lycia Player.exe'),
          );
          // An explicit marker also enables portable mode when an uninstaller happens to be nearby.
          fs.writeFileSync(path.join(staging, 'portable'), '', 'utf8');
          const zipPath = path.join(outputDir, `Lycia.Player_${version}_x64-portable.zip`);
          const psQuote = value => `'${value.replaceAll("'", "''")}'`;
          execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Compress-Archive -LiteralPath ${psQuote(path.join(staging, 'Lycia Player.exe'))},${psQuote(path.join(staging, 'portable'))} -DestinationPath ${psQuote(zipPath)} -Force`,
          ], { cwd: rootDir, stdio: 'inherit', windowsHide: true });
          console.log(`便携版 ZIP 已生成: ${zipPath}`);
        } finally {
          // mkdtemp creates this exact directory inside releases; no user data is included.
          fs.rmSync(staging, { recursive: true, force: true });
        }
      }
      
      console.log(`构建成功: ${target.label}`);
    }

    console.log(`\n==================================================`);
    console.log(`所有构建任务完成！安装包已保存至: ${outputDir}`);
    console.log(`==================================================`);

  } catch (error) {
    console.error('打包过程中出错:', error);
    process.exitCode = 1;
  } finally {
    // Restore tauri.conf.json
    console.log('正在恢复 original tauri.conf.json...');
    fs.writeFileSync(tauriConfigPath, originalConfigContent, 'utf8');
  }
}

main();
