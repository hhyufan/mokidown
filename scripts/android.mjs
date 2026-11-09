/**
 * 一键构建 Android debug/release APK。
 *
 * 直接跑 `cargo build` 或 `tauri android build` 会缺少 MSVC 开发环境
 * （LNK1104: 无法打开文件 msvcrt.lib），这里复用项目自己的
 * scripts/windows-msvc.mjs 注入 vcvars 环境，再依次：
 *   前端构建 → Rust 交叉编译 → 复制 .so 到 jniLibs → Gradle 打包。
 *
 * 用法：
 *   node scripts/android.mjs             # debug
 *   node scripts/android.mjs --release   # release（读取 keystore.properties 签名）
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeMsvc } from './windows-msvc.mjs';

const root = resolve(import.meta.dirname, '..');
const release = process.argv.includes('--release');
const profile = release ? 'release' : 'debug';
const NDK = process.env.ANDROID_NDK_HOME || process.env.NDK_HOME || 'C:\\Env\\NDK\\android-ndk-r27d-windows\\android-ndk-r27d';
const ndkBin = `${NDK}\\toolchains\\llvm\\prebuilt\\windows-x86_64\\bin`;
const target = 'aarch64-linux-android';
const api = 24;
const cc = `${ndkBin}\\aarch64-linux-android${api}-clang.cmd`;
const cxx = `${ndkBin}\\aarch64-linux-android${api}-clang++.cmd`;
const ar = `${ndkBin}\\llvm-ar.exe`;
const ranlib = `${ndkBin}\\llvm-ranlib.exe`;

if (!existsSync(cc)) {
  console.error(`找不到 NDK clang：${cc}`);
  console.error('请设置 NDK_HOME 指向 Android NDK（r26+）。');
  process.exit(1);
}

process.env.JAVA_HOME ||= 'C:\\Env\\jdk\\jdk-17';
process.env.ANDROID_HOME ||= 'C:\\Android\\Sdk';
process.env.ANDROID_SDK_ROOT ||= process.env.ANDROID_HOME;
process.env.NDK_HOME = NDK;
process.env.PATH = `${ndkBin};${process.env.JAVA_HOME}\\bin;${process.env.ANDROID_HOME}\\platform-tools;${process.env.ANDROID_HOME}\\cmdline-tools\\latest\\bin;${process.env.PATH}`;
process.env.CC_aarch64_linux_android = cc;
process.env.CXX_aarch64_linux_android = cxx;
process.env.AR_aarch64_linux_android = ar;
process.env.RANLIB_aarch64_linux_android = ranlib;
process.env.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = cc;

// 注入 MSVC（vcvars）环境；否则链接 build script 时会找不到 msvcrt.lib。
initializeMsvc(['build']);

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root, stdio: 'inherit', env: process.env,
    shell: process.platform === 'win32', ...options,
  });
  if (result.status !== 0) {
    console.error(`\n构建失败：${command} 退出码 ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

// 用 Tauri CLI 生成 Android 工程与前端 assets（tauri.conf.json + dist 文件），
// 它会先构建前端、合并 tauri.android.conf.json、再交叉编译 Rust。非开发者模式下
// 最后的 jniLibs 符号链接会失败，但此时 cargo 产物与 assets 已经就绪，可以忽略。
console.log('\n> tauri android build（生成 Android assets；符号链接失败可忽略）');
spawnSync(process.execPath, [
  'node_modules/@tauri-apps/cli/tauri.js', 'android', 'build',
  ...(release ? [] : ['--debug']), '--apk', '-t', 'aarch64',
], { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });

const so = resolve(root, 'src-tauri', 'target', target, profile, 'libmokidown_lib.so');
const jniDir = resolve(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
if (!existsSync(so)) {
  console.error(`找不到编译产物：${so}（Tauri CLI 可能在前置步骤失败，请查看上方输出）`);
  process.exit(1);
}
mkdirSync(jniDir, { recursive: true });
copyFileSync(so, resolve(jniDir, 'libmokidown_lib.so'));

// 跳过 rust gradle 任务时，Tauri 不会把 dist 同步进 assets；手动同步，
// 否则 APK 里没有 index.html，WebView 起不来会一直停在系统启动图。
const distDir = resolve(root, 'dist');
const assetsDir = resolve(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'assets');
if (existsSync(distDir)) {
  rmSync(assetsDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  cpSync(distDir, assetsDir, { recursive: true });
  const base = JSON.parse(readFileSync(resolve(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const androidPath = resolve(root, 'src-tauri', 'tauri.android.conf.json');
  const merged = existsSync(androidPath)
    ? { ...base, app: { ...base.app, ...JSON.parse(readFileSync(androidPath, 'utf8')).app } }
    : base;
  writeFileSync(resolve(assetsDir, 'tauri.conf.json'), JSON.stringify(merged, null, 2));
  console.log(`已同步前端 assets：${assetsDir}`);
}

const gradlew = resolve(root, 'src-tauri', 'gen', 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(gradlew, [
  release ? 'assembleRelease' : 'assembleDebug',
  '-PabiList=arm64-v8a', '-ParchList=arm64', '-PtargetList=aarch64',
  '-x', 'rustBuildUniversalDebug', '-x', 'rustBuildArm64Debug',
  ...(release ? ['-x', 'rustBuildUniversalRelease', '-x', 'rustBuildArm64Release'] : []),
  '--no-daemon',
], { cwd: resolve(root, 'src-tauri', 'gen', 'android') });

const apk = resolve(root, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'arm64', profile,
  `app-arm64-${profile}.apk`);
console.log(`\n完成：${existsSync(apk) ? apk : '（请检查 Gradle 输出目录）'}`);
