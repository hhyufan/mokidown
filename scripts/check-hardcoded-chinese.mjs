#!/usr/bin/env node
/**
 * 中文硬编码检查。
 *
 * 规则：src/ 下的 JS/JSX 源码中，字符串字面量、模板字符串、JSX 文本不能直接写中文，
 * 只能通过 i18n（t('key')）提供。注释不算——AST 不会把注释当作字符串节点。
 *
 * 豁免：*.test.*、*.d.ts、src/i18n/locales/*（语言包本身）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'espree';

const ROOT = 'src';
const HAN = /[\u4e00-\u9fff]/;
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|jsx)$/.test(entry.name)) continue;
    if (/\.test\.(js|jsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    checkFile(full);
  }
}

function checkFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
      loc: true,
    });
  } catch (error) {
    console.error(`${file}: 无法解析（${error.message}）`);
    process.exitCode = 1;
    return;
  }

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const line = node.loc?.start?.line ?? 0;
    if (node.type === 'Literal' && typeof node.value === 'string' && HAN.test(node.value)) {
      hits.push({ file, line, text: node.value });
    }
    if (node.type === 'TemplateElement' && HAN.test(node.value.raw)) {
      hits.push({ file, line, text: node.value.raw });
    }
    if (node.type === 'JSXText' && HAN.test(node.value)) {
      hits.push({ file, line, text: node.value.trim() });
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && child.type) visit(child);
    }
  };
  visit(ast);
}

walk(ROOT);

if (hits.length) {
  console.error('发现中文硬编码，请改用 i18n t()：');
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.text.slice(0, 80)}`);
  process.exit(1);
}

console.log('中文硬编码检查通过');
