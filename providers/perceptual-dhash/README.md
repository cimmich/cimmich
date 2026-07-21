# Local perceptual dHash provider

This provider computes one symmetric 64-bit grayscale difference-hash score
for two encoded images received over bounded stdin framing. It is deliberately
small: it is useful for exact derivatives and visually close burst frames, not
semantic scene similarity.

It performs no network access, accepts no path in its input, writes no media and
emits no hash vector. Cimmich owns the capture-context thresholds; this process
only returns a canonical unit-interval similarity. A successful process call is
still not provider-execution proof until two distinctly identified results pass
`cimmich.asset-similarity-validation.v1`.

The implementation uses Pillow locally and has no learned model or training
data. The manifest binds the exact provider script digest, preprocessing and
feature-space identity. No recommendation, persistence, accepted identity,
training or automatic identity authority is implied.

Use an isolated Python environment satisfying `requirements.txt` and pass its
interpreter as `CIMMICH_DHASH_PYTHON` for conformance. The provider rejects a
different Pillow runtime rather than silently changing its feature space.
