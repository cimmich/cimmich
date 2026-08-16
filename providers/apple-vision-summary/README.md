# Apple Vision Smart-summary provider

This provider turns macOS Vision framework classifications, Face/Human counts,
animal recognition and optional OCR into the bounded Cimmich Smart-summary fact
contract. It does not identify people and it never changes accepted People or
Context truth.

On a native macOS Local AI worker, Smart uses this provider automatically when
Local AI is enabled and the executable is present. The launcher compiles the
small Swift adapter into one replaceable temporary cache binary on first use;
it downloads no weights and sends no media over a network.

Run raw evidence directly:

```sh
providers/apple-vision-summary/provider photo.jpg
providers/apple-vision-summary/provider --json-array --skip-ocr photo-*.jpg
```

`--skip-ocr` is the normal Smart path when Immich OCR already exists. Cimmich
merges that stored OCR at composition time instead of paying for it twice.

## Use another model

Apple Vision is a default, not a lock-in. Select an Ollama-compatible local
vision model with:

```text
CIMMICH_LOCAL_AI_SUMMARY_SMART_PROVIDER=ollama
CIMMICH_LOCAL_AI_SUMMARY_SMART_MODEL=your-model
CIMMICH_LOCAL_AI_SCENE_TEXT_ENABLED=true
```

Enhanced remains model-configurable independently through the matching
`SUMMARY_ENHANCED_PROVIDER` and `SUMMARY_ENHANCED_MODEL` settings. Ollama stays
restricted to its loopback origin and provider output must pass the same exact
structured-fact validation before Cimmich stores it.
