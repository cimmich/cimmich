const encodedFilename = (value) =>
  encodeURIComponent(String(value || "document")).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const sendBinary = (
  response,
  { bytes, disposition, filename, mimeType },
  origin = "",
) => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-disposition": `${disposition}; filename*=UTF-8''${encodedFilename(filename)}`,
    "content-length": bytes.length,
    "content-security-policy": "sandbox; default-src 'none'",
    "content-type": mimeType,
    "x-content-type-options": "nosniff",
    ...(origin
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {}),
  });
  response.end(bytes);
};

export const sendMapTile = (response, { bytes, mimeType }, origin = "") => {
  response.writeHead(200, {
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "content-length": bytes.length,
    "content-security-policy": "default-src 'none'",
    "content-type": mimeType,
    "x-content-type-options": "nosniff",
    ...(origin
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {}),
  });
  response.end(bytes);
};
