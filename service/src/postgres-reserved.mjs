export const withReservedTransaction = async (sql, callback) => {
  if (typeof sql.begin === "function") return sql.begin(callback);
  await sql`BEGIN`;
  try {
    const result = await callback(sql);
    await sql`COMMIT`;
    return result;
  } catch (error) {
    await sql`ROLLBACK`.catch(() => {});
    throw error;
  }
};

export const releaseReservedConnection = async (sql) => {
  try {
    await sql.release();
  } catch {}
};
