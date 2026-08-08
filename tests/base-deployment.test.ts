/**
 * Base mainnet (8453) deployment row. Base reuses the canonical ERC-5564 announcer and
 * ERC-6538 registry singletons — nothing Opaque-specific is deployed there — so the
 * generated record carries zero-address placeholders in every other contract slot, and
 * the SDK must treat those placeholders as absent stacks:
 *
 *   - `@opaquecash/uab` must not derive a UAB deployment from placeholder slots, so
 *     `scan()`'s cross-chain default stays off and no log fetch ever targets the zero
 *     address (or merges it into the scanned announcer set);
 *   - the client-facing chain bundle must collapse placeholder optionals to `undefined`;
 *   - PSR lookups must report the chain as unsupported rather than hand out zero
 *     addresses.
 */
import { describe, expect, it } from "vitest";
import {
  EVM_DEPLOYMENTS,
  EVM_ZERO_ADDRESS,
  getEvmChainIds,
  isDeployedEvmContract,
  type EvmDeployment,
} from "@opaquecash/deployments";
import { UAB_DEPLOYMENTS, toUabDeployment } from "@opaquecash/uab";
import { getPsrV2Config } from "@opaquecash/psr-chain";
import { OpaqueClient, requireChainDeployment } from "@opaquecash/opaque";

const CANONICAL_ANNOUNCER = "0x55649E01B5Df198D18D95b5cc5051630cfD45564";
const CANONICAL_REGISTRY = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538";
/** Base block the canonical singletons were deployed at (both in the same block). */
const BASE_STEALTH_FROM_BLOCK = 15_502_414n;
/** Base Sepolia block the canonical announcer was deployed at (registry followed at 7675097). */
const BASE_SEPOLIA_STEALTH_FROM_BLOCK = 7_552_655n;

const baseClientConfig = {
  chainId: 8453,
  // Never contacted: every test stubs the client's publicClient before any RPC use.
  rpcUrl: "https://base-rpc.publicnode.com",
  walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
  ethereumAddress: ("0x" + "01".repeat(20)) as `0x${string}`,
};

describe("Base deployment record", () => {
  const base = EVM_DEPLOYMENTS[8453];

  it("targets the canonical ERC-5564/ERC-6538 singletons", () => {
    expect(getEvmChainIds()).toContain(8453);
    expect(base.name).toBe("Base");
    expect(base.contracts.stealthAddressAnnouncer).toBe(CANONICAL_ANNOUNCER);
    expect(base.contracts.stealthMetaAddressRegistry).toBe(CANONICAL_REGISTRY);
    expect(base.stealthFromBlock).toBe(BASE_STEALTH_FROM_BLOCK);
    expect(base.wormhole).toEqual({ chainId: 30, sourceChainId: 1 });
  });

  it("marks every non-stealth stack with the zero-address placeholder", () => {
    for (const slot of [
      base.contracts.opaqueSchemaRegistry,
      base.contracts.opaqueAttestationRegistry,
      base.contracts.opaqueReputationVerifierV2,
      base.contracts.groth16VerifierV2,
      base.contracts.uabSender,
      base.contracts.uabReceiver,
      base.contracts.relayerRegistry,
      base.contracts.opaquePrivacyPool,
      base.contracts.withdrawalVerifier,
      base.contracts.opaqueDisclosureRegistry,
      base.contracts.disclosureVerifier,
    ]) {
      expect(slot).toBe(EVM_ZERO_ADDRESS);
    }
    expect(base.contracts.stealthTokenSweep).toBeUndefined();
    expect(base.psrFromBlock).toBe(0n);
    expect(base.uabFromBlock).toBe(0n);
  });

  it("tracks native ETH and USDC", () => {
    expect(base.tokens).toEqual([
      {
        address: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        decimals: 18,
        native: true,
      },
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        decimals: 6,
      },
    ]);
  });

  it("isDeployedEvmContract distinguishes placeholders from real deployments", () => {
    expect(isDeployedEvmContract(EVM_ZERO_ADDRESS)).toBe(false);
    expect(isDeployedEvmContract(undefined)).toBe(false);
    expect(isDeployedEvmContract(CANONICAL_ANNOUNCER)).toBe(true);
  });
});

describe("Base Sepolia deployment record", () => {
  const baseSepolia = EVM_DEPLOYMENTS[84532];

  it("targets the canonical ERC-5564/ERC-6538 singletons", () => {
    expect(getEvmChainIds()).toContain(84532);
    expect(baseSepolia.name).toBe("Base Sepolia");
    expect(baseSepolia.contracts.stealthAddressAnnouncer).toBe(CANONICAL_ANNOUNCER);
    expect(baseSepolia.contracts.stealthMetaAddressRegistry).toBe(CANONICAL_REGISTRY);
    expect(baseSepolia.stealthFromBlock).toBe(BASE_SEPOLIA_STEALTH_FROM_BLOCK);
    expect(baseSepolia.wormhole).toEqual({ chainId: 10004, sourceChainId: 1 });
  });

  it("marks every non-stealth stack with the zero-address placeholder", () => {
    for (const slot of [
      baseSepolia.contracts.opaqueSchemaRegistry,
      baseSepolia.contracts.opaqueAttestationRegistry,
      baseSepolia.contracts.opaqueReputationVerifierV2,
      baseSepolia.contracts.groth16VerifierV2,
      baseSepolia.contracts.uabSender,
      baseSepolia.contracts.uabReceiver,
      baseSepolia.contracts.relayerRegistry,
      baseSepolia.contracts.opaquePrivacyPool,
      baseSepolia.contracts.withdrawalVerifier,
      baseSepolia.contracts.opaqueDisclosureRegistry,
      baseSepolia.contracts.disclosureVerifier,
      baseSepolia.contracts.wormholeCore,
    ]) {
      expect(slot).toBe(EVM_ZERO_ADDRESS);
    }
    expect(baseSepolia.contracts.stealthTokenSweep).toBeUndefined();
    expect(baseSepolia.psrFromBlock).toBe(0n);
    expect(baseSepolia.uabFromBlock).toBe(0n);
  });

  it("tracks native ETH and USDC", () => {
    expect(baseSepolia.tokens).toEqual([
      {
        address: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        decimals: 18,
        native: true,
      },
      {
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        symbol: "USDC",
        decimals: 6,
      },
    ]);
  });

  it("derives no UAB deployment and reports PSR as unsupported", () => {
    expect(UAB_DEPLOYMENTS[84532]).toBeUndefined();
    expect(getPsrV2Config(84532)).toBeNull();
  });

  it("resolves the client-facing bundle with placeholder optionals collapsed", () => {
    const d = requireChainDeployment(84532);
    expect(d.stealthAddressAnnouncer).toBe(CANONICAL_ANNOUNCER);
    expect(d.stealthMetaAddressRegistry).toBe(CANONICAL_REGISTRY);
    expect(d.opaqueReputationVerifier).toBeUndefined();
    expect(d.stealthTokenSweep).toBeUndefined();
    expect(d.defaultTrackedTokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
  });
});

describe("UAB zero-address guard", () => {
  it("maps a record with placeholder UAB slots to undefined", () => {
    const stealthOnly: EvmDeployment = {
      chainId: 4242,
      name: "StealthOnly",
      contracts: {
        stealthMetaAddressRegistry: CANONICAL_REGISTRY,
        stealthAddressAnnouncer: CANONICAL_ANNOUNCER,
        opaqueSchemaRegistry: EVM_ZERO_ADDRESS,
        opaqueAttestationRegistry: EVM_ZERO_ADDRESS,
        opaqueReputationVerifierV2: EVM_ZERO_ADDRESS,
        groth16VerifierV2: EVM_ZERO_ADDRESS,
        uabSender: EVM_ZERO_ADDRESS,
        uabReceiver: EVM_ZERO_ADDRESS,
        relayerRegistry: EVM_ZERO_ADDRESS,
        opaquePrivacyPool: EVM_ZERO_ADDRESS,
        withdrawalVerifier: EVM_ZERO_ADDRESS,
        opaqueDisclosureRegistry: EVM_ZERO_ADDRESS,
        disclosureVerifier: EVM_ZERO_ADDRESS,
        wormholeCore: EVM_ZERO_ADDRESS,
      },
      wormhole: { chainId: 0, sourceChainId: 1 },
      stealthFromBlock: 1n,
      psrFromBlock: 0n,
      uabFromBlock: 0n,
      tokens: [],
    };
    expect(toUabDeployment(stealthOnly)).toBeUndefined();
    // A fully-deployed record still maps.
    expect(toUabDeployment(EVM_DEPLOYMENTS[11155111])).toMatchObject({
      chainId: 11155111,
      whChain: 2,
    });
  });

  it("derives no UAB deployment from placeholder slots", () => {
    expect(UAB_DEPLOYMENTS[8453]).toBeUndefined();
    for (const uab of Object.values(UAB_DEPLOYMENTS)) {
      expect(uab.uabSender).not.toBe(EVM_ZERO_ADDRESS);
      expect(uab.uabReceiver).not.toBe(EVM_ZERO_ADDRESS);
      expect(uab.wormholeCore).not.toBe(EVM_ZERO_ADDRESS);
    }
  });
});

describe("client-facing Base bundle", () => {
  it("resolves the chain with placeholder optionals collapsed to undefined", () => {
    const d = requireChainDeployment(8453);
    expect(d.stealthAddressAnnouncer).toBe(CANONICAL_ANNOUNCER);
    expect(d.stealthMetaAddressRegistry).toBe(CANONICAL_REGISTRY);
    expect(d.opaqueReputationVerifier).toBeUndefined();
    expect(d.stealthTokenSweep).toBeUndefined();
    expect(d.defaultTrackedTokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
  });

  it("reports PSR as unsupported on Base", () => {
    expect(getPsrV2Config(8453)).toBeNull();
  });
});

describe("OpaqueClient.scan on Base", () => {
  it("scans natively from the singleton deploy block with the cross-chain default off", async () => {
    const client = await OpaqueClient.create(baseClientConfig);
    const contractEventCalls: Array<{
      address?: unknown;
      fromBlock?: bigint;
      toBlock?: bigint;
    }> = [];
    let uabLogCalls = 0;
    (client as unknown as { publicClient: unknown }).publicClient = {
      getContractEvents: async (r: { address?: unknown; fromBlock?: bigint; toBlock?: bigint }) => {
        contractEventCalls.push(r);
        return [];
      },
      // Only the cross-chain (UAB) merge reads raw logs; it must never run here.
      getLogs: async () => {
        uabLogCalls++;
        return [];
      },
      getBlockNumber: async () => BASE_STEALTH_FROM_BLOCK + 100n,
    };

    const out = await client.scan({ chains: ["ethereum"] });
    expect(out).toEqual([]);
    expect(uabLogCalls).toBe(0);
    expect(contractEventCalls.length).toBeGreaterThan(0);
    for (const call of contractEventCalls) {
      // The canonical announcer only — no zero-address UABSender merged into the set.
      expect(call.address).toBe(CANONICAL_ANNOUNCER);
      expect(call.fromBlock).toBeGreaterThanOrEqual(BASE_STEALTH_FROM_BLOCK);
    }
  });

  it("throws the explicit UAB-unconfigured error when cross-chain is forced on", async () => {
    const client = await OpaqueClient.create(baseClientConfig);
    (client as unknown as { publicClient: unknown }).publicClient = {
      getContractEvents: async () => [],
      getLogs: async () => [],
      getBlockNumber: async () => BASE_STEALTH_FROM_BLOCK + 100n,
    };
    await expect(
      client.scan({ chains: ["ethereum"], includeCrossChain: true }),
    ).rejects.toThrow(/UAB not configured for chainId 8453/);
  });
});
