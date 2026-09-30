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
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
  moduleDirectories: ["node_modules", "<rootDir>/src"],
};

module.exports = config;
