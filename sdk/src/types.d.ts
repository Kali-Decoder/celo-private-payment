declare module "circomlibjs" {
  export function buildPoseidon(): Promise<
    ((inputs: (bigint | number)[]) => Uint8Array) & {
      F: {toObject: (x: Uint8Array) => bigint};
    }
  >;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve: (
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ) => Promise<{proof: Record<string, unknown>; publicSignals: string[]}>;
    verify: (
      vkey: object,
      publicSignals: string[],
      proof: object
    ) => Promise<boolean>;
  };
}
