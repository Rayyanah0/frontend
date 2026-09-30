/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": ["babel-jest", { configFile: "./babel.jest.config.js" }],
  },
  moduleNameMapper: {
    // CSS / static asset stubs
    "^.+\\.(css|scss|sass|less)$": "<rootDir>/__mocks__/styleMock.js",
    "^.+\\.(png|jpg|jpeg|gif|svg|ico|webp)$": "<rootDir>/__mocks__/fileMock.js",
    // Heavy native modules — stub them out in the test environment
    "^@stellar/stellar-sdk$": "<rootDir>/__mocks__/stellarSdkMock.js",
    "^@stellar/stellar-sdk/(.*)$": "<rootDir>/__mocks__/stellarSdkMock.js",
    "^@creit\\.tech/stellar-wallets-kit$": "<rootDir>/__mocks__/walletKitMock.js",
    "^@creit\\.tech/stellar-wallets-kit/(.*)$": "<rootDir>/__mocks__/walletKitMock.js",
  },
  testMatch: [
    "**/__tests__/**/*.(ts|tsx|js|jsx)",
    "**/*.(test|spec).(ts|tsx|js|jsx)",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/e2e/"],
  // react-markdown / rehype-sanitize and the unified ecosystem ship ESM only.
  transformIgnorePatterns: [
    "/node_modules/(?!(react-markdown|rehype-.*|remark-.*|unified|unist-.*|mdast-.*|hast-.*|hastscript|micromark.*|vfile.*|bail|ccount|comma-separated-tokens|space-separated-tokens|character-entities.*|character-reference-invalid|decode-named-character-reference|devlop|estree-util-.*|html-url-attributes|is-.*|longest-streak|markdown-table|parse-entities|property-information|stringify-entities|trim-lines|trough|web-namespaces|zwitch|html-void-elements|style-to-.*|inline-style-parser|@ungap)/)",
  ],
  moduleDirectories: ["node_modules", "<rootDir>/src"],
  coverageThreshold: {
    // Issue #123: every resilience policy branch is unit-tested.
    "./src/lib/api/resilience/": { branches: 90, functions: 90, lines: 90, statements: 90 },
    "./src/lib/validation/": { branches: 85, functions: 90, lines: 90, statements: 90 },
    // Clear-signing comparator (#119): every branch is a security check.
    "./src/lib/soroban/intent.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
};

module.exports = config;
