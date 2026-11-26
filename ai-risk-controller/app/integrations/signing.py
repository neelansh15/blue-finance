"""Canonical offchain payload seam. This is NOT EIP-712 or an onchain verifier."""
import hashlib
import json
from typing import Protocol

from app.models import Signature


def canonical_bytes(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def evidence_hash(value: dict) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


class RecommendationSigner(Protocol):
    """Implement in a separately authorised custody/signing system; no private keys here."""
    def sign(self, canonical_payload: bytes) -> Signature: ...


def signing_payload(recommendation: dict, chain_id: int, market_id: str) -> dict:
    return {"domain": "dawn-risk-recommendation-v1", "chain_id": chain_id, "market_id": market_id,
            "recommendation": {k: v for k, v in recommendation.items()
                               if k not in {"signature", "signing_status", "payload_hash"}}}
