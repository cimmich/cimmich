export const handleCimmichMediaCardClick = (event: MouseEvent, selectionMode: boolean, toggleSelection: () => void) => {
  if (!selectionMode) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  toggleSelection();
  return true;
};
