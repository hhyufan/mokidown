export const fileName = (path) => path.split(/[\\/]/).at(-1);

export function filePath(root, path) {
  const joined = `${root.replace(/[\\/]+$/, '')}/${path}`;
  return /^(?:[a-z]:|[\\/]{2})/i.test(root) ? joined.replaceAll('/', '\\') : joined;
}

export const gitRefLabel = (ref) => ref.replace(/^refs\/(heads|remotes)\//, '');

export function githubFileHistoryUrl(remote, branch, path) {
  if (!remote || !branch || !path) return '';
  const repo = remote
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)\/?$/i,
    );
  if (!repo) return '';
  const [, owner, name] = repo;
  const repository = name.replace(/\.git$/i, '');
  const segments = path.split('/');
  if (
    [owner, repository, branch, ...segments].some((part) => !part || part === '.' || part === '..')
  )
    return '';
  return `https://github.com/${owner}/${repository}/commits/${encodeURIComponent(branch)}/${segments.map(encodeURIComponent).join('/')}`;
}
