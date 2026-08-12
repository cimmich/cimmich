export const readBoundedResponseBytes = async (
  response,
  maximumBytes,
  { code, message, statusCode },
) => {
  const fail = () =>
    Object.assign(new Error(message), {
      code,
      statusCode,
    });
  const declaredValue = response?.headers?.get?.("content-length");
  if (declaredValue != null && declaredValue !== "") {
    const declaredBytes = Number(declaredValue);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 1 ||
      declaredBytes > maximumBytes
    ) {
      throw fail();
    }
  }
  if (!response?.body?.getReader) throw fail();

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw fail();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) throw fail();
  return Buffer.concat(chunks, byteLength);
};
