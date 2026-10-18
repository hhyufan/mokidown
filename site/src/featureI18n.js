/**
 * Feature carousel text dictionary.
 *
 * The installer scenes are authored in Chinese; the marketing site can switch
 * to English, so the carousel re-applies this dictionary whenever the page
 * locale changes. Keys are the Chinese source strings, including fragments
 * (some sentences are split across text nodes).
 */
const EN = {
  '写下新的想法': 'Write a new idea',
  '捕捉今天的灵感': "Capture today's spark",
  '灵感随笔.md': 'inspiration.md',
  '开始创作.md': 'start-writing.md',
  '让灵感自然流淌。': 'Let ideas flow naturally.',
  '让 灵感 自然流淌。': 'Let ideas flow naturally.',
  '让': 'Let',
  '灵感': 'ideas',
  '自然流淌。': 'flow naturally.',
  '好的想法，值得记录。': 'Good ideas are worth keeping.',
  '记录今天的灵感': "Note today's spark",
  '写下新的故事': 'Write a new story',
  '所见即所得': 'WYSIWYG',
  '从灵感开始': 'Start from a spark',
  '文件': 'Files',
  '大纲': 'Outline',
  '最近': 'Recent',
  '知识树': 'Knowledge tree',
  '历史': 'History',
  '新建文档': 'New document',
  '打开文件': 'Open file',
  '打开文件夹': 'Open folder',
  '最近的文件': 'Recent files',
  '这里空空的，一个文件都还没有': 'Nothing here yet — no files',
  '打开文件夹后显示文件。': 'Open a folder to see files.',
};

const ZH = {};
Object.keys(EN).forEach((key) => {
  ZH[EN[key]] = key;
});

/**
 * Translate text nodes inside a subtree for the given locale.
 *
 * @param {ParentNode | null} root
 * @param {'zh' | 'en'} locale
 */
export function translateFeatureText(root, locale) {
  if (!root) return;
  const dict = locale === 'en' ? EN : ZH;
  const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  for (const textNode of nodes) {
    let value = textNode.nodeValue;
    for (const [source, target] of entries) {
      if (value.includes(source)) value = value.split(source).join(target);
    }
    if (value !== textNode.nodeValue) textNode.nodeValue = value;
  }
}

export default translateFeatureText;
