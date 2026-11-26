import { commandsCtx } from '@milkdown/kit/core';
import {
  blockquoteKeymap, bulletListKeymap, codeBlockKeymap, emphasisKeymap, headingKeymap,
  hardbreakKeymap, inlineCodeKeymap, listItemKeymap, orderedListKeymap, paragraphKeymap, strongKeymap,
  createCodeBlockCommand, insertHardbreakCommand, liftListItemCommand, sinkListItemCommand,
  toggleEmphasisCommand, toggleInlineCodeCommand, toggleStrongCommand,
  turnIntoTextCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  goToNextTableCellCommand, goToPrevTableCellCommand, strikethroughKeymap,
  tableKeymap, toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { matchesHotkey } from '@hooks/useHotkeys';
import { isImeComposing } from '@utils/keyboard';
import { editingTableContext, handleTableKeyDown } from './milkdownTables';

const commands = {
  markdownBold: [toggleStrongCommand],
  markdownItalic: [toggleEmphasisCommand],
  markdownInlineCode: [toggleInlineCodeCommand],
  markdownStrikethrough: [toggleStrikethroughCommand],
  markdownQuote: [wrapInBlockquoteCommand],
  markdownCodeBlock: [createCodeBlockCommand],
  markdownParagraph: [turnIntoTextCommand],
  markdownOrderedList: [wrapInOrderedListCommand],
  markdownBulletList: [wrapInBulletListCommand],
  markdownLineBreak: [insertHardbreakCommand],
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [
    `markdownHeading${i + 1}`, [wrapInHeadingCommand, i + 1],
  ])),
};

export function disablePresetMarkdownShortcuts(ctx) {
  for (const keymap of [
    blockquoteKeymap, bulletListKeymap, codeBlockKeymap, emphasisKeymap, headingKeymap,
    inlineCodeKeymap, orderedListKeymap, paragraphKeymap, strongKeymap, strikethroughKeymap,
  ]) {
    ctx.update(keymap.key, (entries) => Object.fromEntries(Object.entries(entries).map(([id, entry]) => [
      id, { ...entry, shortcuts: [entry.shortcuts].flat().filter((key) => !key.startsWith('Mod-')) },
    ])));
  }
  for (const keymap of [hardbreakKeymap, listItemKeymap, tableKeymap]) {
    const replaced = new Set(['Shift-Enter', 'Tab', 'Shift-Tab', 'Mod-]', 'Mod-[', 'Mod-Enter']);
    ctx.update(keymap.key, (entries) => Object.fromEntries(Object.entries(entries).map(([id, entry]) => [
      id, { ...entry, shortcuts: [entry.shortcuts].flat().filter((key) => !replaced.has(key)) },
    ])));
  }
}

const navigation = ['markdownNextCellOrIndent', 'markdownPrevCellOrOutdent'];
const commandIds = [...Object.keys(commands), ...navigation];
export const milkdownHotkeys = $prose((ctx) => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (!view.editable || isImeComposing(event) ||
        event.target.closest?.('.cm-editor, input, textarea, select, button')) return false;
      const id = matchesHotkey(event, ...commandIds);
      if (!id) return false;
      const execute = ctx.get(commandsCtx);
      if (navigation.includes(id)) {
        const forward = id === navigation[0];
        const inTable = editingTableContext(view.state);
        if (inTable && forward && handleTableKeyDown(view, event)) return true;
        const command = inTable
          ? forward ? goToNextTableCellCommand : goToPrevTableCellCommand
          : forward ? sinkListItemCommand : liftListItemCommand;
        return execute.call(command.key);
      }
      const [command, payload] = commands[id];
      return execute.call(command.key, payload);
    },
  },
}));
