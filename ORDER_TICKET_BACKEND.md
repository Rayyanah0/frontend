# Order ticket — backend price-protection contract

The professional order ticket (`OrderTicket` / `src/lib/orderTicket.ts`)
enforces quote lifetime and max-slippage / limit-price checks **client-side
today**. The backend should enforce the same rules so a compromised or
stale client cannot bypass protection.

## Proposed request shape

`POST /api/v1/positions/open`

```json
{
  "underlying": "XLM",
  "strike": 0.12,
  "expiry_days": 30,
  "option_type": "call",
  "position_type": "long",
  "contracts": 1,
  "max_slippage_bps": 50,
  "limit_price": 0.0042,
  "quote_id": "optional-opaque-id",
  "quoted_premium": 0.0040
}
```

## Enforcement rules

1. If `limit_price` is set:
   - Long (buy): reject when fill premium **>** `limit_price`
   - Short (write): reject when fill premium **<** `limit_price`
2. If `max_slippage_bps` is set (and the fill is worse than `quoted_premium`):
   - Reject when `|fill - quoted| / quoted * 10000 > max_slippage_bps`
3. On rejection respond with **409**:

```json
{
  "code": "SLIPPAGE_EXCEEDED",
  "quoted": 0.0040,
  "fill": 0.0045,
  "message": "Fill exceeded client price protection"
}
```

Until the backend implements this, the ticket still blocks worse fills
locally via `checkPriceProtection()` before treating the order as filled.
