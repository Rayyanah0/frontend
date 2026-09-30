module.exports = {
  rules: {
    "type-empty": [2, "never"],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert", "deps"],
    ],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
  },
};