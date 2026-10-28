/**
 * 中英文案完整性检查。
 *
 * 检查范围包括应用和安装器：
 *  1. 两个语言文件的键不一致（漏翻译）。
 *  2. 代码里引用了不存在的键——`t('x.y')` 找不到时 i18next 会把键名原样显示到
 *     界面上（例如按钮上出现 `settings.shortcuts.howTo`），这类问题靠肉眼很容易漏。
 *  3. 空文案以及中英文插值参数不一致。
 *
 * 检查 t / i18n.t 的字面量键和条件分支；模板拼接（`` t(`a.${b}`) ``）不作静态推断。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = {
  zh: JSON.parse(readFileSync(join(root, 'src/i18n/locales/zh_cn.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(root, 'src/i18n/locales/en_us.json'), 'utf8')),
};

/** 递归收集待检查的源码文件。 */
function collectFiles(directory, collected = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectFiles(path, collected);
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.(js|jsx)$/.test(entry)) {
      collected.push(path);
    }
  }
  return collected;
}

const problems = [];

// 1. 两个语言文件的键必须完全一致。
const zhKeys = new Set(Object.keys(LOCALES.zh));
const enKeys = new Set(Object.keys(LOCALES.en));
for (const key of zhKeys) if (!enKeys.has(key)) problems.push(`en_us.json 缺少键：${key}`);
for (const key of enKeys) if (!zhKeys.has(key)) problems.push(`zh_cn.json 缺少键：${key}`);

const placeholders = (value) => [...new Set([...String(value).matchAll(/\{\{\s*-?\s*([\w.]+)(?:\s*,[^}]*)?\s*\}\}/g)].map((match) => match[1]))].sort().join(',');
for (const key of zhKeys) {
  for (const [locale, values] of Object.entries(LOCALES)) {
    // Idle update status deliberately renders no label.
    if (typeof values[key] !== 'string' || (key !== 'update.idle' && !values[key].trim())) problems.push(`${locale} 的 ${key} 文案为空或不是字符串`);
  }
  if (enKeys.has(key) && placeholders(LOCALES.zh[key]) !== placeholders(LOCALES.en[key])) {
    problems.push(`${key} 中英文插值参数不一致`);
  }
}

// 2. 代码里引用的字面量键必须存在。
const quoted = /(?<![\w])(?:i18n\.)?t\(\s*(['"])([A-Za-z][\w.]*)\1/g;
const referenced = new Set();
for (const file of [...collectFiles(join(root, 'src')), ...collectFiles(join(root, 'installer/src'))]) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(quoted)) {
    referenced.add(`${match[2]}\u0000${relative(root, file).split(sep).join('/')}`);
  }
  // Include literal alternatives in t(condition ? 'a.b' : 'c.d').
  for (const call of source.matchAll(/\bt\(\s*([^\n)]*)/g)) {
    const argument = call[1].split(',')[0];
    if (!argument.includes('?')) continue;
    for (const match of argument.matchAll(/(['"])([A-Za-z][\w]*\.[\w.]+)\1/g)) {
      referenced.add(`${match[2]}\u0000${relative(root, file).split(sep).join('/')}`);
    }
  }
}
for (const entry of referenced) {
  const [key, file] = entry.split('\u0000');
  if (!zhKeys.has(key)) problems.push(`${file} 引用了不存在的键：${key}`);
}

if (problems.length > 0) {
  console.error(`文案检查未通过（${problems.length} 项）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`文案检查通过：zh/en 各 ${zhKeys.size} 条，代码引用 ${referenced.size} 处均存在`);
