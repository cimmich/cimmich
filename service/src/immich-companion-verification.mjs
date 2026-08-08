export const verifiedCompanionStatus = async (
  companion,
  { failClosed = false } = {},
) => {
  const status = await companion.status();
  if (status.state !== "ready") return status;
  try {
    const verified = await companion.verifyOnboardingPermissions();
    return {
      ...status,
      capabilities: verified.capabilities,
      permissionVerification: verified.permissionVerification,
      permissions: verified.permissions,
    };
  } catch (error) {
    if (failClosed) throw error;
    return {
      ...status,
      capabilities: {
        assetRead: false,
        assetSearch: false,
        faceRead: false,
        mediaRead: false,
        personList: false,
        personRead: false,
      },
      code: error?.code || "IMMICH_COMPANION_PERMISSION_CHECK_FAILED",
      permissionVerification: "failed",
      state:
        error?.code === "IMMICH_COMPANION_AUTH_FAILED"
          ? "unauthorized"
          : "unavailable",
    };
  }
};
