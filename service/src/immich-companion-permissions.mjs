export const IMMICH_READ_ONLY_COMPANION_PERMISSIONS = Object.freeze([
  "asset.read",
  "asset.download",
  "face.read",
  "person.read",
  "user.read",
]);

export const isExactImmichReadOnlyCompanionPermissionSet = (value) =>
  Array.isArray(value) &&
  value.length === IMMICH_READ_ONLY_COMPANION_PERMISSIONS.length &&
  value.every(
    (permission, index) =>
      permission === IMMICH_READ_ONLY_COMPANION_PERMISSIONS[index],
  );
