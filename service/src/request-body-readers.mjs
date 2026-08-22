export const readJsonBody = async (request, maximumBytes = 32_768) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    chunks.push(buffer);
    if (bytes > maximumBytes) {
      throw Object.assign(new Error("Request body too large"), {
        code: "REQUEST_BODY_TOO_LARGE",
        statusCode: 413,
      });
    }
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      code: "REQUEST_JSON_INVALID",
      statusCode: 400,
    });
  }
};

export const readBinaryBody = async (request, maximum = 25 * 1024 * 1024) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) {
      throw Object.assign(new Error("Document content is too large"), {
        code: "DOCUMENT_TOO_LARGE",
        statusCode: 413,
      });
    }
    chunks.push(chunk);
  }
  if (!bytes) {
    throw Object.assign(new Error("Document content is required"), {
      code: "DOCUMENT_CONTENT_INVALID",
      statusCode: 400,
    });
  }
  return Buffer.concat(chunks, bytes);
};

export const readDocumentMetadataHeader = (request) => {
  const encoded = String(request.headers["x-cimmich-document-metadata"] || "");
  if (
    !encoded ||
    encoded.length > 12_000 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw Object.assign(new Error("Document metadata header is invalid"), {
      code: "DOCUMENT_METADATA_INVALID",
      statusCode: 400,
    });
  }
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value;
  } catch {
    throw Object.assign(new Error("Document metadata header is invalid"), {
      code: "DOCUMENT_METADATA_INVALID",
      statusCode: 400,
    });
  }
};
