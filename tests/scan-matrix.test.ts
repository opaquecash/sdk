/**
 * Phase 2.2 — four-quadrant cross-chain scan matrix.
 *
 * One recipient, four REAL DKSAP payments (fresh ephemeral keys via
 * `prepareStealthSend`), one per quadrant:
 *
 *   | announced on | scanned from | path                                   |
 *   |--------------|--------------|----------------------------------------|
 *   | Ethereum     | Ethereum     | native Announcement log                |
 *   | Solana       | Solana       | native Announcement anchor event       |
 *   | Ethereum     | Solana       | UAB → uab-receiver CrossChainAnnouncement |
 *   | Solana       | Ethereum     | UAB → UABReceiver CrossChainAnnouncement  |
 *
 * Transports are stubbed (live Wormhole delivery is Phase 3.1's
 * wormhole-local-validator job) but everything else is real: canonical event
 * encodings on both chains, the 96-byte UAB payload codec, adapter
 * normalisation, the WASM view-tag filter, and full DKSAP ownership recovery.
 *
 * Needs the scanner WASM from the app checkout, so the suite skips when the
 * sdk repo is checked out alone (same pattern as psr-prover-v2.test.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { Connection } from "@solana/web3.js";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from "viem";
import { encodeUabPayload } from "@opaquecash/stealth-core";
import { initStealthWasm } from "@opaquecash/stealth-wasm";
import {
  CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  SolanaAdapter,
  encodeAnnouncementEventData,
  getSolanaDeployment,
} from "@opaquecash/stealth-chain-solana";
import { OpaqueClient } from "@opaquecash/opaque";

const ROOT = new URL("../..", import.meta.url).pathname;
const WASM_JS = `${ROOT}app/public/pkg/cryptography.js`;
const WASM_BIN = `${ROOT}app/public/pkg/cryptography_bg.wasm`;
const wasmPresent = existsSync(WASM_JS) && existsSync(WASM_BIN);

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const bytesToHex0x = (b: Uint8Array): Hex => ("0x" + Buffer.from(b).toString("hex")) as Hex;

const announcementEventAbi = parseAbi([
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
]);

type Prep = {
  stealthAddress: Hex;
  viewTag: number;
  ephemeralPublicKey: Uint8Array;
  metadata: Uint8Array;
};

/** Raw EVM log (data + topics) the way `getContractEvents` returns it. */
function evmAnnouncementLog(p: Prep, logIndex: number) {
  const topics = encodeEventTopics({
    abi: announcementEventAbi,
    eventName: "Announcement",
    args: {
      schemeId: 1n,
      stealthAddress: p.stealthAddress,
      caller: ("0x" + "99".repeat(20)) as Hex,
    },
  });
  const data = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [bytesToHex0x(p.ephemeralPublicKey), bytesToHex0x(p.metadata)],
  );
  return {
    data,
    topics,
    logIndex,
    blockNumber: 100n,
    transactionHash: ("0x" + "e1".repeat(32)) as Hex,
  };
}

function uabPayloadFor(p: Prep, sourceChainId: number): Uint8Array {
  return encodeUabPayload({
    viewTag: p.viewTag,
    ephemeralPubKey: p.ephemeralPublicKey,
    stealthAddress: hexToBytes(p.stealthAddress),
    sourceChainId,
    schemeId: 1,
    metadata: p.metadata.slice(1, 25),
  });
}

/** Anchor `Program data:` log line for a Solana event payload. */
const anchorLog = (data: Uint8Array): string =>
  `Program data: ${Buffer.from(data).toString("base64")}`;

/** uab-receiver CrossChainAnnouncement event bytes. */
function crossChainEventData(payload: Uint8Array, sourceChain: number): Uint8Array {
  const buf = Buffer.alloc(8 + 2 + 32 + 8 + 4 + payload.length);
  let o = 0;
  Buffer.from(CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR).copy(buf, o);
  o += 8;
  buf.writeUInt16LE(sourceChain, o);
  o += 2;
  Buffer.alloc(32, 0x44).copy(buf, o);
  o += 32;
  buf.writeBigUInt64LE(9n, o);
  o += 8;
  buf.writeUInt32LE(payload.length, o);
  o += 4;
  Buffer.from(payload).copy(buf, o);
  return buf;
}

function stubSolanaConnection(perProgramLogs: Map<string, string[]>): Connection {
  return {
    getSignaturesForAddress: async (program: { toBase58(): string }) =>
      perProgramLogs.has(program.toBase58())
        ? [{ signature: `sig-${program.toBase58()}`, slot: 50, err: null }]
        : [],
    getTransaction: async (signature: string) => {
      for (const [program, logs] of perProgramLogs) {
        if (signature === `sig-${program}`) return { meta: { logMessages: logs } };
      }
      return null;
    },
  } as unknown as Connection;
}

describe.skipIf(!wasmPresent)("four-quadrant cross-chain scan matrix (2.2)", () => {
  beforeAll(async () => {
    await initStealthWasm({
      moduleSpecifier: pathToFileURL(WASM_JS).href,
      // Node cannot fetch(file://); hand the glue the wasm bytes directly.
      wasmBinaryUrl: readFileSync(WASM_BIN) as unknown as string,
    });
  });

  it("scan() returns all four quadrants with correct chain + source tags", async () => {
    const deployment = getSolanaDeployment("devnet");

    const client = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "https://ethereum-sepolia.publicnode.com", // never contacted (stubbed below)
      walletSignature: ("0x" + "37".repeat(65)) as Hex,
      ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
      wasmModuleSpecifier: pathToFileURL(WASM_JS).href,
      solana: { connection: stubSolanaConnection(new Map()), deployment },
    });
    const meta = client.getMetaAddressHex();

    // Four real payments to this recipient + one decoy to someone else.
    const ethNative = client.prepareStealthSend(meta);
    const solNative = client.prepareStealthSend(meta);
    const ethToSol = client.prepareStealthSend(meta);
    const solToEth = client.prepareStealthSend(meta);
    const stranger = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "https://ethereum-sepolia.publicnode.com",
      walletSignature: ("0x" + "53".repeat(65)) as Hex,
      ethereumAddress: ("0x" + "02".repeat(20)) as Hex,
    });
    const decoy = client.prepareStealthSend(stranger.getMetaAddressHex());

    // --- Ethereum side: native Announcement raw logs + UABReceiver decoded logs ---
    const evmStub = {
      getContractEvents: async () => [
        evmAnnouncementLog(ethNative, 0),
        evmAnnouncementLog(decoy, 1),
      ],
      getLogs: async () => [
        {
          args: {
            sourceChain: 1,
            sourceEmitter: ("0x" + "44".repeat(32)) as Hex,
            sequence: 9n,
            payload: bytesToHex0x(uabPayloadFor(solToEth, 1)),
          },
          transactionHash: ("0x" + "e2".repeat(32)) as Hex,
          blockNumber: 101n,
          logIndex: 0,
        },
      ],
      getBlockNumber: async () => 200n,
    };
    // The lazily-built EvmAdapter and the UAB merge both read this.publicClient.
    (client as unknown as { publicClient: unknown }).publicClient = evmStub;

    // --- Solana side: native announcer event + uab-receiver CrossChainAnnouncement ---
    const solConn = stubSolanaConnection(
      new Map([
        [
          deployment.stealthAnnouncer.toBase58(),
          [
            anchorLog(
              encodeAnnouncementEventData({
                schemeId: 1n,
                stealthAddress: hexToBytes(solNative.stealthAddress),
                caller: new Uint8Array(32),
                ephemeralPubKey: solNative.ephemeralPublicKey,
                metadata: solNative.metadata,
              }),
            ),
          ],
        ],
        [
          deployment.uabReceiver.toBase58(),
          [anchorLog(crossChainEventData(uabPayloadFor(ethToSol, 2), 2))],
        ],
      ]),
    );
    // Inject a pre-built adapter so the lazy getter never constructs one from config.
    (client as unknown as { solanaAdapter?: SolanaAdapter }).solanaAdapter =
      new SolanaAdapter({ connection: solConn, deployment });

    const out = await client.scan({ chains: ["ethereum", "solana"] });

    const got = out
      .map((o) => ({
        chain: o.chain,
        source: o.source,
        stealthAddress: o.stealthAddress.toLowerCase(),
      }))
      .sort((a, b) =>
        `${a.chain}/${a.source}`.localeCompare(`${b.chain}/${b.source}`),
      );

    expect(got).toEqual(
      [
        { chain: "ethereum", source: "native", stealthAddress: ethNative.stealthAddress.toLowerCase() },
        { chain: "ethereum", source: "uab", stealthAddress: solToEth.stealthAddress.toLowerCase() },
        { chain: "solana", source: "native", stealthAddress: solNative.stealthAddress.toLowerCase() },
        { chain: "solana", source: "uab", stealthAddress: ethToSol.stealthAddress.toLowerCase() },
      ].sort((a, b) => `${a.chain}/${a.source}`.localeCompare(`${b.chain}/${b.source}`)),
    );

    // The decoy (payment to a different meta-address) must not appear anywhere.
    const decoyAddr = decoy.stealthAddress.toLowerCase();
    expect(out.some((o) => o.stealthAddress.toLowerCase() === decoyAddr)).toBe(false);
  }, 60_000);
});
