# MiewID Pet matching — disabled in the V1 release

This directory preserves the bounded crop and evaluation work from Cimmich's
private MiewID experiment, but the model-loading route is deliberately disabled.

The publisher snapshot requires Transformers `trust_remote_code`, which executes
Python supplied by the model repository. The experiment previously pointed at
the publisher's moving current snapshot and therefore had neither an immutable,
reviewed code revision nor a Cimmich-owned digest manifest. A locally downloaded
snapshot does not remove that arbitrary-code boundary.

Cimmich V1 consequently does not provide an install command for this model and
`provider.py` fails closed before importing Torch or Transformers. The model is
not bundled, downloaded or executed by the release. The remaining Pillow-only
requirements and helpers support deterministic crop-contract tests; they are not
an operational embedding provider.

Re-enabling the route in a future experimental build requires all of:

- a rights-cleared model and code revision identified immutably;
- a reviewed manifest containing SHA-256 digests for every executable and
  checkpoint artifact;
- loading without `trust_remote_code` or an explicitly isolated, no-network,
  read-only worker boundary for reviewed publisher code; and
- reproducible conformance, decompression-bound and replay-drift tests.

The model publisher page is retained only as provenance:
<https://huggingface.co/conservationxlabs/miewid-msv3>. The current model card
does not declare a model licence; Cimmich does not grant rights to use it.
