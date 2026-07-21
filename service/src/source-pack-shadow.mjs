import { compileSourcePack, digestValue } from "./source-pack.mjs";

const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort();

const faceIdsFor = (pack, bucketKind) =>
  sortedUnique(
    pack.references
      .filter(
        (reference) =>
          reference.referenceKind === "face" &&
          reference.bucketKind === bucketKind,
      )
      .map((reference) => reference.faceId),
  );

const personIdsFor = (pack, bucketKind) =>
  sortedUnique(
    pack.references
      .filter(
        (reference) =>
          reference.referenceKind === "face" &&
          reference.bucketKind === bucketKind,
      )
      .map((reference) => reference.personId),
  );

const membershipDigest = (values) => digestValue(sortedUnique(values));

export const compileShadowSourcePack = (
  faces,
  options,
  { expectedAnchoredPersonIds = [], expectedPrimeFaceIds = [] } = {},
) => {
  const pack = compileSourcePack(faces, options);
  const actualPrimeFaceIds = faceIdsFor(pack, "prime");
  const actualPrimePersonIds = personIdsFor(pack, "prime");
  const expected = sortedUnique(expectedPrimeFaceIds);
  const actual = new Set(actualPrimeFaceIds);
  const expectedSet = new Set(expected);
  const missing = expected.filter((faceId) => !actual.has(faceId));
  const unexpected = actualPrimeFaceIds.filter(
    (faceId) => !expectedSet.has(faceId),
  );
  const parityChecked = expected.length > 0;
  const expectedAnchoredPeople = sortedUnique(expectedAnchoredPersonIds);
  const actualPeople = new Set(actualPrimePersonIds);
  const missingAnchoredPeople = expectedAnchoredPeople.filter(
    (personId) => !actualPeople.has(personId),
  );
  const coverageChecked = expectedAnchoredPeople.length > 0;
  const parityPassed =
    parityChecked && missing.length === 0 && unexpected.length === 0;
  const coveragePassed = coverageChecked && missingAnchoredPeople.length === 0;
  const status =
    !parityChecked || !parityPassed
      ? "failed"
      : coverageChecked && !coveragePassed
        ? "blocked"
        : "passed";

  return {
    pack,
    receipt: {
      schemaVersion: "cimmich.source-pack-shadow-compile.v1",
      status,
      boundary: {
        activation: "none",
        databaseWrites: "none",
        identityWrites: "none",
        persistence: "none",
      },
      compile: {
        configDigest: pack.configDigest,
        dimension: pack.dimension,
        evidenceCutoff: pack.evidenceCutoff,
        modelFamily: pack.modelFamily,
        modelVersion: pack.modelVersion,
        packDigest: pack.packDigest,
        packId: pack.packId,
        policyVersion: pack.policyVersion,
        sourceRevisionDigest: pack.sourceRevisionDigest,
        summary: pack.summary,
      },
      membership: {
        lowQualityDigest: membershipDigest(faceIdsFor(pack, "lq")),
        primeDigest: membershipDigest(actualPrimeFaceIds),
        primePeopleCount: actualPrimePersonIds.length,
        primePeopleDigest: membershipDigest(actualPrimePersonIds),
        secondaryDigest: membershipDigest(faceIdsFor(pack, "secondary")),
      },
      anchoredPersonCoverage: {
        actualPrimePeopleCount: actualPrimePersonIds.length,
        checked: coverageChecked,
        expectedAnchoredPeopleCount: expectedAnchoredPeople.length,
        expectedAnchoredPeopleDigest: membershipDigest(expectedAnchoredPeople),
        missingCount: missingAnchoredPeople.length,
        passed: coveragePassed,
      },
      primeParity: {
        actualCount: actualPrimeFaceIds.length,
        actualDigest: membershipDigest(actualPrimeFaceIds),
        checked: parityChecked,
        expectedCount: expected.length,
        expectedDigest: membershipDigest(expected),
        missingCount: missing.length,
        passed: parityPassed,
        unexpectedCount: unexpected.length,
      },
    },
  };
};
