# SAM2 Body-mask provider

Optional local-only box-prompted silhouette evidence for Cimmich Body
observations. It consumes one bounded in-memory image plus exact anonymous Body
IDs/boxes, runs the declared SAM2 checkpoint with network forbidden and returns
canonical cropped binary RLE masks and policy-derived
`geometry_valid|review|abstained` dispositions. `geometry_valid` means only
that the mask is bounded and numerically coherent with the supplied Body box.
The service independently rederives crop geometry, foreground area and prompt
containment from the RLE on its declared raster canvas; provider-reported
metrics cannot grant a disposition. Semantic purity remains unverified and the
mask grants no Body-count authority.

This provider does not decide people counts, identity, Face ownership, matching,
training or activation. Masks are additive geometry evidence and require exact
two-run replay plus the validated Body-result envelope before projection.

The V1 selection/QC policy is frozen from the reviewed RMP SAM2.1 trusted-box
machinery: 8% prompt expansion; reject below 5% or above 135% prompt area, or
below 62% expanded-box containment; review below 78% containment, above 92%
prompt area or below 0.35 SAM2 score.

Mask payload digests use six-decimal strings for normalized crop coordinates
and exact integer canvas/origin/RLE fields, avoiding language-specific floating
JSON spellings. Crops must be minimal: foreground touches every crop boundary.
