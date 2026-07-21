import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  createImmichCompanion,
  normalizeImmichApiBaseUrl,
} from "./immich-companion.mjs";

const typedError = (code, message, statusCode = 500) =>
  Object.assign(new Error(message), { code, statusCode });

const normalizeCredentialFile = (value) => {
  const filename = String(value || "").trim();
  if (!filename) return "";
  if (
    !path.isAbsolute(filename) ||
    filename === "/" ||
    filename.endsWith("/")
  ) {
    throw typedError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich credential file must be a dedicated absolute file path",
    );
  }
  return filename;
};

const normalizeCredential = ({ apiBaseUrl, apiKey }) => {
  const normalizedApiBaseUrl = normalizeImmichApiBaseUrl(apiBaseUrl);
  const normalizedApiKey = String(apiKey || "").trim();
  if (
    !normalizedApiBaseUrl ||
    normalizedApiKey.length < 16 ||
    normalizedApiKey.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(normalizedApiKey)
  ) {
    throw typedError(
      "IMMICH_COMPANION_CREDENTIAL_INVALID",
      "Immich connection credentials are invalid",
      400,
    );
  }
  return { apiBaseUrl: normalizedApiBaseUrl, apiKey: normalizedApiKey };
};

const readCredential = async (filename) => {
  if (!filename) return null;
  try {
    const metadata = await stat(filename);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw typedError(
        "IMMICH_COMPANION_CREDENTIAL_FILE_UNSAFE",
        "Immich credential file must be a private regular file",
      );
    }
    const value = JSON.parse(await readFile(filename, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "apiBaseUrl,apiKey"
    ) {
      throw new Error("invalid shape");
    }
    return normalizeCredential(value);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code?.startsWith?.("IMMICH_")) throw error;
    throw typedError(
      "IMMICH_COMPANION_CREDENTIAL_FILE_INVALID",
      "Immich credential file is invalid",
    );
  }
};

const writeCredential = async (filename, credential) => {
  if (!filename) {
    throw typedError(
      "IMMICH_COMPANION_CREDENTIAL_STORE_UNAVAILABLE",
      "Cimmich was not configured with a private companion credential store",
      409,
    );
  }
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(credential)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporary, 0o600);
    await rename(temporary, filename);
    await chmod(filename, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error?.code?.startsWith?.("IMMICH_")) throw error;
    throw typedError(
      "IMMICH_COMPANION_CREDENTIAL_STORE_FAILED",
      "Cimmich could not persist the Immich connection credential",
      503,
    );
  }
};

export const createImmichCompanionManager = async ({
  apiBaseUrl = "",
  apiKey = "",
  credentialFile = "",
  fetchImpl = globalThis.fetch,
  timeoutMs,
} = {}) => {
  const filename = normalizeCredentialFile(credentialFile);
  const stored = await readCredential(filename);
  const initial =
    stored ||
    (String(apiBaseUrl || "").trim() && String(apiKey || "").trim()
      ? normalizeCredential({ apiBaseUrl, apiKey })
      : null);
  let companion = createImmichCompanion({
    ...(initial || {}),
    fetchImpl,
    ...(timeoutMs == null ? {} : { timeoutMs }),
  });
  let permissionReceipt = null;

  const manager = {
    async connect({ apiBaseUrl: nextUrl, apiKey: nextKey }) {
      const credential = normalizeCredential({
        apiBaseUrl: nextUrl,
        apiKey: nextKey,
      });
      const candidate = createImmichCompanion({
        ...credential,
        fetchImpl,
        ...(timeoutMs == null ? {} : { timeoutMs }),
      });
      const status = await candidate.status();
      if (status.state !== "ready") {
        throw typedError(
          status.code || "IMMICH_COMPANION_NOT_READY",
          "Immich connection validation failed",
          status.state === "incompatible" ? 409 : 503,
        );
      }
      const verified = await candidate.verifyOnboardingPermissions();
      await writeCredential(filename, credential);
      companion = candidate;
      permissionReceipt = verified;
      return {
        ...status,
        capabilities: verified.capabilities,
        permissions: verified.permissions,
        permissionVerification: verified.permissionVerification,
        credentialStored: true,
        credentialTransport: "request_only",
      };
    },
    getAsset: (...args) => companion.getAsset(...args),
    getPerson: (...args) => companion.getPerson(...args),
    listAssetFaces: (...args) => companion.listAssetFaces(...args),
    listAssets: (...args) => companion.listAssets(...args),
    listPeople: (...args) => companion.listPeople(...args),
    readAssetImage: (...args) => companion.readAssetImage(...args),
    async status() {
      const status = await companion.status();
      return {
        ...status,
        ...(status.state === "ready" && permissionReceipt
          ? {
              capabilities: permissionReceipt.capabilities,
              permissionVerification: permissionReceipt.permissionVerification,
            }
          : {}),
        credentialStore: filename ? "private_file" : "environment_only",
        setupWritable: Boolean(filename),
      };
    },
    async verifyOnboardingPermissions(...args) {
      const verified = await companion.verifyOnboardingPermissions(...args);
      permissionReceipt = verified;
      return verified;
    },
  };
  return Object.freeze(manager);
};
