// Minimal stand-in for zenith-backend used by the Playwright suite. The BFF
// is pointed at it through BFF_UPSTREAM_URL (see playwright.config.ts).
import http from "node:http";

export const MOCK_TOKEN = "e2e.eyJleHAiOjQxMDI0NDQ4MDB9.bearer-token-must-never-reach-js";
export const MOCK_WALLET = "GE2EWALLETADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export function startMockBackend(port = Number(process.env.MOCK_BACKEND_PORT ?? 8799)) {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/api/v1/auth/nonce" && req.method === "POST") return send(200, { nonce: "n", message: "m" });
      if (req.url === "/api/v1/auth/verify" && req.method === "POST") {
        const body = JSON.parse(raw || "{}");
        return send(200, { token: MOCK_TOKEN, wallet_address: body.wallet_address });
      }
      if (req.url === "/api/v1/auth/me") {
        return auth === `Bearer ${MOCK_TOKEN}` ? send(200, { wallet_address: MOCK_WALLET }) : send(401, { error: "unauthorized" });
      }
      if (req.url === "/api/v1/account") {
        return auth === `Bearer ${MOCK_TOKEN}`
          ? send(200, { wallet_address: MOCK_WALLET, balance: 1000, collateral_locked: 0 })
          : send(401, { error: "unauthorized" });
      }
      return send(404, { error: "not found" });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  startMockBackend().then(() => console.log("mock backend listening"));
}
