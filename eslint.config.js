import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "dist/**", ".cache/**", "samples/**", "server/compiler/__fixtures__/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["server/**/*.js", "vite.config.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
