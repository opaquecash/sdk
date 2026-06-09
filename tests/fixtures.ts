/**
 * Canonical 96-byte UAB payload fixtures, hand-constructed from the layout in
 * spec/payload-format.md (the oracle), matching the bytes observed in the live
 * Sepolia <-> Solana devnet end-to-end runs.
 */

const hexConcat = (...parts: string[]): `0x${string}` => `0x${parts.join("")}` as `0x${string}`;

/** Solana -> Ethereum announcement seen on testnet (view tag 0x42, stealth 0xab..). */
export const SOL_TO_ETH = {
  hex: hexConcat(
    "42", // view tag
    "02" + "11".repeat(32), // ephemeral pubkey (33)
    "00".repeat(12) + "ab".repeat(20), // stealth address (32, left-padded)
    "0001", // source chain id = Solana (1)
    "00000001", // scheme id = 1
    "deadbeef" + "00".repeat(20), // metadata (24)
  ),
  viewTag: 0x42,
  sourceChainId: 1,
  schemeId: 1,
  ephemeralPubKey: ("0x02" + "11".repeat(32)) as `0x${string}`,
  stealthAddressEvm: ("0x" + "ab".repeat(20)) as `0x${string}`,
  metadataTail: "0xdeadbeef" as `0x${string}`,
};

/** Ethereum -> Solana announcement seen on testnet (view tag 0x77, stealth 0xcd..). */
export const ETH_TO_SOL = {
  hex: hexConcat(
    "77",
    "03" + "22".repeat(32),
    "00".repeat(12) + "cd".repeat(20),
    "0002", // source chain id = Ethereum (2)
    "00000001",
    "11223344" + "00".repeat(20),
  ),
  viewTag: 0x77,
  sourceChainId: 2,
  schemeId: 1,
  ephemeralPubKey: ("0x03" + "22".repeat(32)) as `0x${string}`,
  stealthAddressEvm: ("0x" + "cd".repeat(20)) as `0x${string}`,
  metadataTail: "0x11223344" as `0x${string}`,
};
