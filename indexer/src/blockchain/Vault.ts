/** ABIs used by the indexer (root posting). Deposit events use parseAbiItem in EventWatcher. */
export const merkleRootManagerAbi = [
  {
    type: "function",
    name: "postRoot",
    stateMutability: "nonpayable",
    inputs: [{name: "root", type: "bytes32"}],
    outputs: [],
  },
  {
    type: "function",
    name: "isKnownRoot",
    stateMutability: "view",
    inputs: [{name: "root", type: "bytes32"}],
    outputs: [{name: "", type: "bool"}],
  },
  {
    type: "function",
    name: "latestRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "bytes32"}],
  },
] as const;
