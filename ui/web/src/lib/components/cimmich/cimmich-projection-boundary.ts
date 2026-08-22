export const beginCimmichProjection = (generation: number, clear: () => void) => {
  clear();
  return generation + 1;
};

export const isCurrentCimmichProjection = (generation: number, currentGeneration: number) =>
  generation === currentGeneration;
