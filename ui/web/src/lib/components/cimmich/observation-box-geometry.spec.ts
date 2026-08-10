import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  adjustObservationBoxWithKeyboard,
  clampObservationBox,
  observationArrowKey,
  observationBoxFromDrag,
} from './observation-box-geometry';

const image = { height: 800, width: 1000 };
const box = { x1: 100, x2: 300, y1: 200, y2: 500 };

describe('observation box geometry', () => {
  it('recognises only the four geometry keys', () => {
    expect(observationArrowKey('ArrowLeft')).toBe('ArrowLeft');
    expect(observationArrowKey('Enter')).toBeUndefined();
  });

  it('moves a box without changing its size or leaving the image', () => {
    expect(observationBoxFromDrag(box, image, 'move', -500, 500)).toEqual({
      x1: 0,
      x2: 200,
      y1: 500,
      y2: 800,
    });
  });

  it('clamps resized edges to the image and the 24 pixel quality floor', () => {
    expect(clampObservationBox({ x1: -20, x2: 10, y1: 790, y2: 900 }, image)).toEqual({
      x1: 0,
      x2: 24,
      y1: 776,
      y2: 800,
    });
    expect(observationBoxFromDrag(box, image, 'nw', 500, 500)).toEqual({
      x1: 276,
      x2: 300,
      y1: 476,
      y2: 500,
    });
    expect(observationBoxFromDrag(box, image, 'e', -500, 0)).toEqual({
      x1: 100,
      x2: 124,
      y1: 200,
      y2: 500,
    });
  });

  it('moves by a bounded image-relative keyboard step', () => {
    expect(adjustObservationBoxWithKeyboard(box, image, 'move', 'ArrowRight')).toEqual({
      x1: 105,
      x2: 305,
      y1: 200,
      y2: 500,
    });
    expect(adjustObservationBoxWithKeyboard(box, image, 'move', 'ArrowDown', true)).toEqual({
      x1: 100,
      x2: 300,
      y1: 216,
      y2: 516,
    });
  });

  it('adjusts only an edge owned by the focused resize handle', () => {
    expect(adjustObservationBoxWithKeyboard(box, image, 'nw', 'ArrowLeft')).toEqual({
      x1: 95,
      x2: 300,
      y1: 200,
      y2: 500,
    });
    expect(adjustObservationBoxWithKeyboard(box, image, 'nw', 'ArrowUp')).toEqual({
      x1: 100,
      x2: 300,
      y1: 196,
      y2: 500,
    });
    expect(adjustObservationBoxWithKeyboard(box, image, 'n', 'ArrowLeft')).toBe(box);
  });

  it('keeps the Face and Body controls wired to the tested keyboard path and its instructions', async () => {
    const overlay = await readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8');
    expect(overlay).toContain("onkeydown={(event) => handleFaceBoxKeydown(event, face, 'move')}");
    expect(overlay).toContain('onkeydown={(event) => handleBodyBoxKeydown(event, body, handle.mode)}');
    expect(overlay).toContain('Shift moves farther. Enter saves; Escape cancels.');
  });
});
