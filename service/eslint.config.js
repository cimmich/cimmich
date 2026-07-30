import eslint from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["{acceptance,bin,src,test}/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
    rules: {
      ...eslint.configs.recommended.rules,
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["test/**/*.mjs"],
    rules: {
      "no-regex-spaces": "off",
      "no-useless-escape": "off",
    },
  },
];
