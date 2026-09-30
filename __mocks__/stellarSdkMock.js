// Minimal stub for @stellar/stellar-sdk used in Jest tests.
// We don't need the real SDK for unit/RTL tests.

module.exports = {
  Contract: class Contract {
    constructor() {}
    call() { return {}; }
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  nativeToScVal: jest.fn((v) => ({ value: () => v })),
  SorobanRpc: {
    Server: class Server {
      getAccount() { return Promise.resolve({ sequence: "1" }); }
      simulateTransaction() { return Promise.resolve({}); }
      sendTransaction() { return Promise.resolve({ hash: "abc", status: "PENDING" }); }
      getTransaction() { return Promise.resolve({ status: "SUCCESS" }); }
    },
    Api: {
      isSimulationError: jest.fn(() => false),
      isSimulationSuccess: jest.fn(() => true),
      GetTransactionStatus: { SUCCESS: "SUCCESS", FAILED: "FAILED", NOT_FOUND: "NOT_FOUND" },
    },
    assembleTransaction: jest.fn((tx) => ({ build: () => ({ toXDR: () => "xdr-stub" }) })),
  },
  TransactionBuilder: class TransactionBuilder {
    constructor() {}
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return { toXDR: () => "xdr-stub" }; }
  },
  Transaction: class Transaction {
    constructor() {}
  },
  BASE_FEE: "100",
  xdr: {
    ScVal: class ScVal {},
  },
};
