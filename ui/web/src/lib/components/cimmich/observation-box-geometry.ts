export type ObservationBox = { x1: number; x2: number; y1: number; y2: number };
export type ObservationBoxEditMode = 'e' | 'move' | 'n' | 'ne' | 'nw' | 's' | 'se' | 'sw' | 'w';
export type ObservationArrowKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp';
export type ObservationBoxPointerDrag = {
  image: ImageSize;
  mode: ObservationBoxEditMode;
  pointerId: number;
  startBox: ObservationBox;
  startClientX: number;
  startClientY: number;
};

type ImageSize = { height: number; width: number };

const MINIMUM_BOX_SIZE = 24;

export const observationBoxHandles: Array<{ label: string; mode: ObservationBoxEditMode }> = [
  { label: 'Resize top left', mode: 'nw' },
  { label: 'Resize top', mode: 'n' },
  { label: 'Resize top right', mode: 'ne' },
  { label: 'Resize left', mode: 'w' },
  { label: 'Resize right', mode: 'e' },
  { label: 'Resize bottom left', mode: 'sw' },
  { label: 'Resize bottom', mode: 's' },
  { label: 'Resize bottom right', mode: 'se' },
];

export const observationBoxesMatch = (left: ObservationBox, right: ObservationBox) =>
  left.x1 === right.x1 && left.x2 === right.x2 && left.y1 === right.y1 && left.y2 === right.y2;

export const observationBoxRegion = (box: ObservationBox, image: ImageSize) => ({
  h: (box.y2 - box.y1) / image.height,
  w: (box.x2 - box.x1) / image.width,
  x: box.x1 / image.width,
  y: box.y1 / image.height,
});

export const observationArrowKey = (key: string): ObservationArrowKey | undefined =>
  key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' ? key : undefined;

export const consumeObservationArrow = (
  event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>,
): ObservationArrowKey | undefined => {
  const key = observationArrowKey(event.key);
  if (!key) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  return key;
};

export const clampObservationBox = (box: ObservationBox, image: ImageSize): ObservationBox => {
  const minimumWidth = Math.min(MINIMUM_BOX_SIZE, image.width);
  const minimumHeight = Math.min(MINIMUM_BOX_SIZE, image.height);
  const x1 = Math.round(Math.max(0, Math.min(box.x1, image.width - minimumWidth)));
  const y1 = Math.round(Math.max(0, Math.min(box.y1, image.height - minimumHeight)));
  const x2 = Math.round(Math.min(image.width, Math.max(box.x2, x1 + minimumWidth)));
  const y2 = Math.round(Math.min(image.height, Math.max(box.y2, y1 + minimumHeight)));
  return { x1, x2, y1, y2 };
};

export const observationBoxFromDrag = (
  startBox: ObservationBox,
  image: ImageSize,
  mode: ObservationBoxEditMode,
  deltaX: number,
  deltaY: number,
): ObservationBox => {
  if (mode === 'move') {
    const width = startBox.x2 - startBox.x1;
    const height = startBox.y2 - startBox.y1;
    const x1 = Math.max(0, Math.min(image.width - width, startBox.x1 + deltaX));
    const y1 = Math.max(0, Math.min(image.height - height, startBox.y1 + deltaY));
    return { x1: Math.round(x1), x2: Math.round(x1 + width), y1: Math.round(y1), y2: Math.round(y1 + height) };
  }

  const box = { ...startBox };
  if (mode.includes('w')) {
    box.x1 = Math.max(0, Math.min(startBox.x2 - MINIMUM_BOX_SIZE, startBox.x1 + deltaX));
  }
  if (mode.includes('e')) {
    box.x2 = Math.min(image.width, Math.max(startBox.x1 + MINIMUM_BOX_SIZE, startBox.x2 + deltaX));
  }
  if (mode.includes('n')) {
    box.y1 = Math.max(0, Math.min(startBox.y2 - MINIMUM_BOX_SIZE, startBox.y1 + deltaY));
  }
  if (mode.includes('s')) {
    box.y2 = Math.min(image.height, Math.max(startBox.y1 + MINIMUM_BOX_SIZE, startBox.y2 + deltaY));
  }
  return { x1: Math.round(box.x1), x2: Math.round(box.x2), y1: Math.round(box.y1), y2: Math.round(box.y2) };
};

export const observationBoxFromPointerDrag = (
  drag: ObservationBoxPointerDrag,
  pointer: { clientX: number; clientY: number },
  metrics: { height: number; imageHeight: number; imageWidth: number; width: number },
) =>
  observationBoxFromDrag(
    drag.startBox,
    drag.image,
    drag.mode,
    ((pointer.clientX - drag.startClientX) / metrics.width) * metrics.imageWidth,
    ((pointer.clientY - drag.startClientY) / metrics.height) * metrics.imageHeight,
  );

export const adjustObservationBoxWithKeyboard = (
  box: ObservationBox,
  image: ImageSize,
  mode: ObservationBoxEditMode,
  key: ObservationArrowKey,
  accelerated = false,
): ObservationBox => {
  const horizontalStep = Math.max(1, Math.round(image.width * (accelerated ? 0.02 : 0.005)));
  const verticalStep = Math.max(1, Math.round(image.height * (accelerated ? 0.02 : 0.005)));
  const deltaX = key === 'ArrowLeft' ? -horizontalStep : key === 'ArrowRight' ? horizontalStep : 0;
  const deltaY = key === 'ArrowUp' ? -verticalStep : key === 'ArrowDown' ? verticalStep : 0;

  if (mode !== 'move' && ((deltaX !== 0 && !/[ew]/.test(mode)) || (deltaY !== 0 && !/[ns]/.test(mode)))) {
    return box;
  }
  return observationBoxFromDrag(box, image, mode, deltaX, deltaY);
};
