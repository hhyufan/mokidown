import MilkdownTooltips from '@components/editor/MilkdownTooltips';

function anchorAtContentEdge(row, list) {
  const { top, height } = row.getBoundingClientRect();
  const content = list.closest('.sidebar__content') ?? list;
  return { left: content.getBoundingClientRect().right, top, width: 0, height };
}

export default function SidebarFileTooltips({ listRef }) {
  return (
    <MilkdownTooltips
      rootRef={listRef}
      targetSelector="[data-moki-tooltip]"
      placement="right"
      getAnchorRect={anchorAtContentEdge}
      mouseEnterDelay={500}
    />
  );
}
