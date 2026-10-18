import { INSTALLER_URL } from '@/configs/repository';

const ALIYUN_MANIFESTS = [
  'https://mokidown-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.json',
  'https://mokidown-updates.oss-accelerate.aliyuncs.com/updates/latest.json',
];

const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/hhyufan/mokidown/releases/latest';

/** 带超时的 JSON 请求；失败返回 null，交给下一个来源。 */
async function fetchJson(url, timeout = 4000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 解析「下载安装包」按钮应当打开的地址。
 *
 * 1. 先读阿里云 OSS 的最新版更新清单（国内最快，需 Bucket 配好 CORS）；
 * 2. 拿不到就查 GitHub 最新 Release，直接取同名 EXE 资产（GitHub API 支持 CORS）；
 * 3. 都失败时回退到 Releases 页面，保证按钮始终有去处。
 *
 * @returns {Promise<string>} 安装包直链或 Releases 页面。
 */
export async function resolveInstallerUrl() {
  for (const manifestUrl of ALIYUN_MANIFESTS) {
    const manifest = await fetchJson(manifestUrl);
    const url = manifest?.platforms?.['windows-x86_64']?.url;
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
  }

  const release = await fetchJson(GITHUB_LATEST_RELEASE);
  const asset = release?.assets?.find((item) => /MokiDown_.*_x64-setup\.exe$/i.test(item.name || ''));
  if (asset?.browser_download_url) return asset.browser_download_url;

  return INSTALLER_URL;
}

export default resolveInstallerUrl;
