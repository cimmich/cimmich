<script lang="ts">
  import {
    fitIdentityReviewCrop,
    identityReviewSvgTransform,
    rotateIdentityReviewSource,
    type IdentityReviewCropSource,
  } from './identity-review-crop';

  interface Props {
    alt: string;
    fullContext?: boolean;
    item: IdentityReviewCropSource;
    rotationQuarterTurns?: number;
    src: string;
    targetAspect?: number;
  }

  let { alt, fullContext = false, item, rotationQuarterTurns = 0, src, targetAspect = 4 / 3 }: Props = $props();
  const turns = $derived(((Math.trunc(rotationQuarterTurns) % 4) + 4) % 4);
  const rotated = $derived(rotateIdentityReviewSource(item, turns));
  const crop = $derived(fitIdentityReviewCrop(rotated, targetAspect));
  const viewBox = $derived(
    fullContext
      ? `0 0 ${rotated.width} ${rotated.height}`
      : `${crop.x * rotated.width} ${crop.y * rotated.height} ${crop.w * rotated.width} ${crop.h * rotated.height}`,
  );
  const transform = $derived(identityReviewSvgTransform(item.width, item.height, turns));
  const outline = $derived({
    height: rotated.box.h * rotated.height,
    width: rotated.box.w * rotated.width,
    x: rotated.box.x * rotated.width,
    y: rotated.box.y * rotated.height,
  });
</script>

<svg class="block size-full bg-gray-200" {viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label={alt}>
  <image href={src} width={item.width} height={item.height} {transform} preserveAspectRatio="none" />
  <rect
    x={outline.x}
    y={outline.y}
    width={outline.width}
    height={outline.height}
    fill="none"
    stroke="rgba(255,255,255,0.7)"
    stroke-width="2"
    stroke-dasharray="0.1 4"
    stroke-linecap="round"
    vector-effect="non-scaling-stroke"
    style="filter: drop-shadow(0 0 1px rgba(0,0,0,0.7))"
  />
</svg>
