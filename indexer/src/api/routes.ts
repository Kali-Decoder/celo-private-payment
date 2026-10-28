import type {FastifyInstance} from "fastify";
import type {SyncService} from "../services/SyncService.js";
import {config} from "../config/index.js";

export async function registerRoutes(
  app: FastifyInstance,
  sync: SyncService
): Promise<void> {
  app.get("/health", async () => {
    const state = await sync.sync.get();
    return {
      status: "ok",
      eventSource: config.eventSource,
      lastBlock: state.lastProcessedBlock,
      latestRoot: state.lastRoot,
      treeDepth: state.treeDepth,
      confirmations: config.confirmations,
    };
  });

  app.get("/root", async (_req, reply) => {
    const latest = await sync.roots.latest();
    const state = await sync.sync.get();
    if (!latest && !state.lastRoot) {
      return reply.code(404).send({error: "no_root"});
    }
    return {
      root: latest?.root ?? state.lastRoot,
      leafCount: latest?.leafCount ?? sync.tree.size,
      posted: latest?.posted ?? false,
    };
  });

  app.get<{Params: {commitment: string}}>("/witness/:commitment", async (req, reply) => {
    const commitment = normalizeHex(req.params.commitment);
    if (!commitment) {
      return reply.code(400).send({error: "invalid_commitment"});
    }
    const witness = await sync.getWitness(commitment);
    if (!witness) {
      return reply.code(404).send({error: "not_found_or_unfinalized"});
    }
    // Never include secrets — siblings + path only
    return witness;
  });

  app.get<{Params: {commitment: string}}>("/deposit/:commitment", async (req, reply) => {
    const commitment = normalizeHex(req.params.commitment);
    if (!commitment) {
      return reply.code(400).send({error: "invalid_commitment"});
    }
    const dep = await sync.deposits.findByCommitment(commitment);
    if (!dep) {
      return reply.code(404).send({error: "not_found"});
    }
    return {
      commitment: dep.commitment,
      leafIndex: dep.leafIndex,
      token: dep.token,
      amount: dep.amount,
      blockNumber: dep.blockNumber,
      blockHash: dep.blockHash,
      txHash: dep.txHash,
      finalized: dep.finalized,
      createdAt: dep.createdAt,
    };
  });

  app.get("/stats", async () => {
    const leaves = await sync.deposits.countFinalized();
    const roots = await sync.roots.count();
    const latest = await sync.roots.latest();
    const state = await sync.sync.get();
    return {
      leaves,
      roots,
      latestRoot: latest?.root ?? state.lastRoot,
      lastProcessedBlock: state.lastProcessedBlock,
      treeSize: sync.tree.size,
      eventSource: config.eventSource,
    };
  });
}

function normalizeHex(raw: string): string | null {
  const s = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return null;
  return s.toLowerCase();
}
