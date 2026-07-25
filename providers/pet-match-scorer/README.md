# Pet match scorer

This weight-free adapter converts local embedding output into bounded Cimmich
review proposals. It never writes a Pet identity itself.

- Gallery records use `role: "gallery"` and `identity: "<Cimmich Pet ID>"`.
- Query records use `role: "query"` and a stable observation ID.
- Comparisons are restricted to the same species.
- One run binds exactly one species and vector space. PetFace cat and dog
  checkpoints therefore require separate runs.
- A Pet score is the closest confirmed gallery photo, while `galleryCount`
  remains visible in Review.
- `candidateFloor` is explicit configuration. Cimmich does not claim that the
  current private bake-off is large enough to publish a universal threshold.
- No candidate above the configured floor becomes an **Unknown Pet**, rather
  than being forced onto the nearest named Pet.

The generated `cimmich.pet-matching.v1` packet can be imported through
`POST /v1/pets/matching:import`. The normal Pet Review page remains the only
place a proposal becomes accepted Face or Whole-animal evidence.
