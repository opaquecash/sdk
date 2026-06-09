import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { uabSenderAbi, wormholeCoreAbi } from "./abis.js";
import { CONSISTENCY_FINALIZED } from "./config.js";

/** Fields for a cross-chain announcement (mirrors a native announce + a consistency level). */
export interface AnnounceWithRelayArgs {
  schemeId: bigint;
  stealthAddress: Address;
  ephemeralPubKey: Hex;
  /** EIP-5564 metadata: view tag in byte 0, then up to 24 bytes carried cross-chain. */
  metadata: Hex;
  /** Wormhole finality: 200 = finalized (default), 201 = safe (faster on testnet). */
  consistencyLevel?: number;
}

/** A ready-to-sign transaction request for the connected wallet to submit. */
export interface AnnounceWithRelayRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

/** ABI-encode the `announceWithRelay` calldata. */
export function encodeAnnounceWithRelay(args: AnnounceWithRelayArgs): Hex {
  return encodeFunctionData({
    abi: uabSenderAbi,
    functionName: "announceWithRelay",
    args: [
      args.schemeId,
      args.stealthAddress,
      args.ephemeralPubKey,
      args.metadata,
      args.consistencyLevel ?? CONSISTENCY_FINALIZED,
    ],
  });
}

/** Read the Wormhole message fee (wei) required by `announceWithRelay`. */
export async function getWormholeMessageFee(client: PublicClient, wormholeCore: Address): Promise<bigint> {
  return client.readContract({ address: wormholeCore, abi: wormholeCoreAbi, functionName: "messageFee" });
}

/** Build a `{to,data,value}` request for `announceWithRelay`, with the Wormhole fee as `value`. */
export async function buildAnnounceWithRelayRequest(
  client: PublicClient,
  params: { uabSender: Address; wormholeCore: Address } & AnnounceWithRelayArgs,
): Promise<AnnounceWithRelayRequest> {
  const value = await getWormholeMessageFee(client, params.wormholeCore);
  return { to: params.uabSender, data: encodeAnnounceWithRelay(params), value };
}
