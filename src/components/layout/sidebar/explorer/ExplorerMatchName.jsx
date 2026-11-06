import { textSearchRange } from '@utils/searchMatching';

export default function ExplorerMatchName({ name, search }) {
  const match = search.open ? textSearchRange(name, search.query.trim(), search.caseSensitive) : null;
  if (!match) return name;
  return <>{name.slice(0, match.start)}<mark className="explorer-match">{name.slice(match.start, match.start + match.length)}</mark>{name.slice(match.start + match.length)}</>;
}
