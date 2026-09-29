/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // @stellar/stellar-sdk pulls in sodium-native (a Node.js native addon)
    // for Ed25519 signing in server environments. It's not needed in the
    // browser — the SDK falls back to WebCrypto/TweetNaCl automatically.
    // Marking it as external (server) and false (client) suppresses the
    // "critical dependency" bundler warnings without breaking anything.
    if (isServer) {
      config.externals = [...(config.externals ?? []), "sodium-native"];
    } else {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        "sodium-native": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
