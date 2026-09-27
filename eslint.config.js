import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "web/**", "prisma/migrations/**", "var/**"],
  },
  ...tseslint.configs.recommended,
);
