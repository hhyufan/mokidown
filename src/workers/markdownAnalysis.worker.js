import { extractItems } from '../utils/markdownOutline';

self.onmessage = ({ data: { id, content = '' } }) => {
  self.postMessage({ id, result: {
    footnotes: content,
    outline: extractItems(content),
  } });
};
