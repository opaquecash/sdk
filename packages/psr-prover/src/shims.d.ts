declare module "snarkjs" {
  export const groth16: {
    fullProve: (
      input: unknown,
      wasmPath: string,
      zkeyPath: string,
    ) => Promise<{ proof: Record<string, unknown>; publicSignals: string[] }>;
    verify: (
      vkeyPath: string,
      publicSignals: string[],
      proof: Record<string, unknown>,
    ) => Promise<boolean>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<{
    F: {
      e: (n: bigint) => unknown;
      toObject: (x: unknown) => bigint;
    };
    (inputs: bigint[]): unknown;
  }>;
  export function buildBabyjub(): Promise<{
    Base8: unknown;
    mulPointEscalar: (base: unknown, s: bigint) => unknown;
  }>;
}
