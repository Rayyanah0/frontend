// Minimal stub for @creit.tech/stellar-wallets-kit used in Jest tests.
module.exports = {
  StellarWalletsKit: {
    init: jest.fn(),
    setWallet: jest.fn(),
    getAddress: jest.fn(() => Promise.resolve({ address: "GABCDE" })),
    getNetwork: jest.fn(() => Promise.resolve({ networkPassphrase: "Test SDF Network ; September 2015" })),
    signTransaction: jest.fn(() => Promise.resolve({ signedTxXdr: "signed-xdr" })),
    signMessage: jest.fn(() => Promise.resolve({ signedMessage: "signed-msg" })),
    disconnect: jest.fn(() => Promise.resolve()),
    refreshSupportedWallets: jest.fn(() => Promise.resolve([])),
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  FREIGHTER_ID: "freighter",
  XBULL_ID: "xbull",
  ALBEDO_ID: "albedo",
  LOBSTR_ID: "lobstr",
  HANA_ID: "hana",
  RABET_ID: "rabet",
  FreighterModule: class FreighterModule {},
  xBullModule: class xBullModule {},
  AlbedoModule: class AlbedoModule {},
  LobstrModule: class LobstrModule {},
  HanaModule: class HanaModule {},
  RabetModule: class RabetModule {},
};
