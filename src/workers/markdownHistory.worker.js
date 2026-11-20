import { createMarkdownHistoryComparison } from '../components/history/markdownHistoryComparison';

let compare = null;

self.onmessage = ({ data }) => {
  if ('original' in data) {
    compare = createMarkdownHistoryComparison(data.original);
    return;
  }
  if (!compare) return;
  self.postMessage(compare(data.modified));
};
