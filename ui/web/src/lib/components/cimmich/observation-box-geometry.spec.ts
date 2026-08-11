import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  adjustObservationBoxWithKeyboard,
  clampObservationBox,
  consumeObservationArrow,
  observationArrowKey,
  observationBoxFromDrag,
  observationBoxFromPointerDrag,
  observationBoxRegion,
  observationBoxesMatch,
} from './observation-box-geometry';

const image = { height: 800, width: 1000 };
const box = { x1: 100, x2: 300, y1: 200, y2: 500 };

describe('observation box geometry', () => {
  it('recognises only the four geometry keys', () => {
    expect(observationArrowKey('ArrowLeft')).toBe('ArrowLeft');
    expect(observationArrowKey('Enter')).toBeUndefined();
  });

  it('compares and normalises observation regions', () => {
    expect(observationBoxesMatch(box, { ...box })).toBe(true);
    expect(observationBoxesMatch(box, { ...box, x2: 301 })).toBe(false);
    expect(observationBoxRegion(box, image)).toEqual({ h: 0.375, w: 0.2, x: 0.1, y: 0.25 });
  });

  it('moves a box without changing its size or leaving the image', () => {
    expect(observationBoxFromDrag(box, image, 'move', -500, 500)).toEqual({
      x1: 0,
      x2: 200,
      y1: 500,
      y2: 800,
    });
  });

  it('maps pointer movement through the rendered image scale', () => {
    expect(
      observationBoxFromPointerDrag(
        {
          image,
          mode: 'move',
          pointerId: 4,
          startBox: box,
          startClientX: 20,
          startClientY: 30,
        },
        { clientX: 70, clientY: 70 },
        { height: 400, imageHeight: 800, imageWidth: 1000, width: 500 },
      ),
    ).toEqual({ x1: 200, x2: 400, y1: 280, y2: 580 });
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

  it('consumes geometry arrows even when a clamped adjustment will be a no-op', () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    expect(consumeObservationArrow({ key: 'ArrowLeft', preventDefault, stopPropagation })).toBe('ArrowLeft');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(consumeObservationArrow({ key: 'Enter', preventDefault, stopPropagation })).toBeUndefined();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps first adjustment feedback in persistent polite live regions', async () => {
    const overlay = await readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8');
    expect(overlay).toContain(
      '<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{faceActionMessage}</p>',
    );
    expect(overlay).toContain(
      '<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{observationActionMessage}</p>',
    );
    expect(overlay).toContain("role={observationActionError ? 'alert' : undefined}");
  });

  it('cancels an active geometry draft in window capture before Escape can close the overlay', async () => {
    const overlay = await readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8');
    const handler = overlay.slice(
      overlay.indexOf('const handleWindowKeyDown'),
      overlay.indexOf('const sidecarSections'),
    );
    const faceCancel = handler.indexOf('faceBoxDrafts[selectedFaceId]');
    const bodyCancel = handler.indexOf('bodyBoxDrafts[selectedBodyId]');
    const overlayClose = handler.indexOf("overlayView !== 'off'");

    expect(faceCancel).toBeGreaterThan(0);
    expect(bodyCancel).toBeGreaterThan(faceCancel);
    expect(overlayClose).toBeGreaterThan(bodyCancel);
    expect(handler).toContain("faceActionMessage = 'Face position change cancelled.'");
    expect(handler).toContain("observationActionMessage = 'Body position change cancelled.'");
    expect(overlay).not.toContain("event.key === 'Escape' && faceBoxDrafts[face.id]");
    expect(overlay).not.toContain("event.key === 'Escape' && bodyBoxDrafts[body.id]");
  });
});
