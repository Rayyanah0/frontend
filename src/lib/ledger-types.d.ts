// Type declarations for Ledger hardware wallet packages, which are
// dynamically imported only when the user connects a Ledger device.
// These are intentionally loose — the real types ship with the packages
// when installed; this file keeps the build green without bundling them.

declare module "@ledgerhq/hw-transport-webhid" {
  export class TransportWebHID {
    static request(): Promise<TransportWebHID>;
    static create(): Promise<TransportWebHID>;
    close(): Promise<void>;
    on(event: string, cb: (...args: any[]) => void): void;
    exchange(apdu: Buffer): Promise<Buffer>;
  }
  export default TransportWebHID;
}

declare module "@ledgerhq/hw-transport-webusb" {
  export class TransportWebUSB {
    static request(): Promise<TransportWebUSB>;
    static create(): Promise<TransportWebUSB>;
    close(): Promise<void>;
    on(event: string, cb: (...args: any[]) => void): void;
    exchange(apdu: Buffer): Promise<Buffer>;
  }
  export default TransportWebUSB;
}

declare module "@ledgerhq/hw-app-str" {
  export class Str {
    constructor(transport: any);
    getPath(): Promise<string>;
    getPublicKey(path: string, opts?: { verify?: boolean }): Promise<any>;
    getAddress(path: string, opts?: { verify?: boolean }): Promise<any>;
    signHash(path: string, hashHex: string): Promise<any>;
    signTransaction(path: string, txXdr: string): Promise<any>;
  }
  export default Str;
}