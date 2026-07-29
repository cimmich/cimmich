// A fake sql tag that understands nested sql fragments the way postgres.js
// does: interpolated fragments contribute their composed text, plain
// parameters render as "?", and awaiting the top-level call records the
// final statement before resolving the canned rows.
export const createFragmentAwareSql = (record, rows = []) => {
  const sql = (strings, ...values) => {
    const text = strings.reduce((acc, part, index) => {
      const value = values[index];
      if (value === undefined) {
        return acc + part;
      }
      if (value !== null && typeof value === "object" && "fragmentText" in value) {
        return acc + part + value.fragmentText;
      }
      return acc + part + "?";
    }, "");
    return {
      fragmentText: text,
      then(resolve, reject) {
        record(text);
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
  };
  return sql;
};
