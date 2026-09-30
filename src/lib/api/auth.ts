import { apiGet, apiPost } from "./client";
import { MeResponseSchema, NonceResponseSchema, VerifyResponseSchema } from "./schemas";

export interface NonceResponse {
  nonce?: string;
  message?: string;
}

export function requestNonce(walletAddress: string): Promise<NonceResponse> {
  return apiPost("/api/v1/auth/nonce", { wallet_address: walletAddress }, undefined, NonceResponseSchema);
}

export interface VerifyResponse {
  token?: string;
  wallet_address?: string;
}

export function verifySignature(params: {
  walletAddress: string;
  message: string;
  signature: string; // base64-encoded 64-byte ed25519 signature
}): Promise<VerifyResponse> {
  return apiPost("/api/v1/auth/verify", {
    wallet_address: params.walletAddress,
    message: params.message,
    signature: params.signature,
  }, undefined, VerifyResponseSchema);
}

export function getMe(token: string): Promise<{ wallet_address?: string }> {
  return apiGet("/api/v1/auth/me", token, MeResponseSchema);
}
