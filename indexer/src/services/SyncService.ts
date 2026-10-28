import type {Hex, PublicClient} from "viem";
import {config} from "../config/index.js";
import {createIndexerPublicClient} from "../blockchain/RootPoster.js";
import {RootPoster} from "../blockchain/RootPoster.js";
import {
  DepositRepository,
  RootRepository,
  SyncStateRepository,
} from "../db/DepositRepository.js";
import {PoseidonTree} from "../merkle/PoseidonTree.js";
import {
  GoldskyDepositSource,
  type DepositSource,
} from "../goldsky/GoldskyDepositSource.js";
import {GoldskyRootSource} from "../goldsky/GoldskyRootSource.js";
import {RpcDepositSource} from "../watcher/EventWatcher.js";
import type {DepositEvent, WitnessResponse} from "../types/index.js";

/**
 * Core loop: hydrate tree → ingest deposits (Goldsky or RPC) → confirmations →
 * insert leaf → post root → serve witnesses.
 */
export class SyncService {
  readonly tree: PoseidonTree;
  readonly deposits = new DepositRepository();
  readonly roots = new RootRepository();
  readonly sync = new SyncStateRepository();
  readonly source: DepositSource;
  readonly poster: RootPoster;
  readonly goldskyRoots: GoldskyRootSource | null;
  private readonly client: PublicClient;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private tickBusy = false;

  constructor(client?: PublicClient) {
    this.client = client ?? createIndexerPublicClient();
    this.poster = new RootPoster(this.client);
    this.tree = new PoseidonTree(config.treeDepth);

    if (config.eventSource === "goldsky") {
      this.source = new GoldskyDepositSource(config.goldskyVaultUrl);
      this.goldskyRoots = config.goldskyRootManagerUrl
        ? new GoldskyRootSource(config.goldskyRootManagerUrl)
        : null;
    } else {
      this.source = new RpcDepositSource(this.client);
      this.goldskyRoots = null;
    }
  }

  async start(): Promise<void> {
    await this.hydrate();
    const state = await this.sync.get();
    if (state.lastProcessedBlock < config.startBlock) {
      const jumpTo = Math.max(0, config.startBlock - 1);
      await this.sync.update({lastProcessedBlock: jumpTo});
      console.log(
        `[sync] cursor ${state.lastProcessedBlock} < START_BLOCK ${config.startBlock}; jumped to ${jumpTo}`
      );
    }
    this.running = true;
    console.log(
      `[sync] started source=${config.eventSource} pool=${config.poolAddress} confirmations=${config.confirmations}`
    );
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async hydrate(): Promise<void> {
    const finalized = await this.deposits.listFinalizedOrdered();
    const commitments = finalized.map((d) => d.commitment);
    const root = await this.tree.rebuild(commitments);
    await this.sync.update({
      lastRoot: commitments.length ? root : null,
      treeDepth: config.treeDepth,
    });
    console.log(`[sync] hydrated ${commitments.length} leaf(s) root=${root}`);

    if (commitments.length > 0 && !config.skipPostRoot) {
      try {
        const tx = await this.poster.postRoot(root as Hex);
        if (tx) await this.roots.markPosted(root, tx);
        else await this.roots.upsert(root, commitments.length, null);
      } catch (err) {
        console.warn(
          "[sync] postRoot after hydrate failed (non-fatal):",
          err instanceof Error ? err.message.slice(0, 200) : err
        );
      }
    }

    for (const rootHex of await this.roots.unposted()) {
      try {
        if (
          this.goldskyRoots &&
          (await this.goldskyRoots.isRootPosted(rootHex))
        ) {
          await this.roots.markPosted(rootHex, "goldsky");
          continue;
        }
        const tx = await this.poster.postRoot(rootHex as Hex);
        if (tx) await this.roots.markPosted(rootHex, tx);
      } catch (err) {
        console.warn(`[sync] retry postRoot ${rootHex} failed:`, err);
      }
    }
  }

  async tick(): Promise<{ingested: number; finalized: number}> {
    if (this.tickBusy) return {ingested: 0, finalized: 0};
    this.tickBusy = true;
    try {
      const latest = await this.source.latestBlock();
      const state = await this.sync.get();

      let from =
        state.lastProcessedBlock > 0
          ? state.lastProcessedBlock + 1
          : config.startBlock;
      // Cap range — Goldsky pages internally; keep windows bounded.
      const to = Math.min(latest, from + 2_000 - 1);
      let ingested = 0;

      if (to >= from) {
        const events = await this.source.fetchDeposits(from, to);
        for (const ev of events) {
          const inserted = await this.deposits.insertIgnore({
            commitment: ev.commitment,
            leafIndex: ev.leafIndex,
            token: ev.token,
            amount: ev.amount.toString(),
            blockNumber: ev.blockNumber,
            blockHash: ev.blockHash,
            txHash: ev.txHash,
            logIndex: ev.logIndex,
            finalized: false,
          });
          if (inserted) ingested++;
        }
        await this.sync.update({lastProcessedBlock: to});
      }

      const finalized = await this.finalizeUpTo(latest - config.confirmations);
      return {ingested, finalized};
    } finally {
      this.tickBusy = false;
    }
  }

  private async finalizeUpTo(safeBlock: number): Promise<number> {
    if (safeBlock < 0) return 0;
    const pending = await this.deposits.listPendingFinalization(safeBlock);
    if (pending.length === 0) return 0;

    let count = 0;
    for (const d of pending) {
      const expected = await this.deposits.nextExpectedLeafIndex();
      if (d.leafIndex !== expected) {
        if (d.leafIndex < expected) {
          await this.deposits.markFinalized(d.id!);
          continue;
        }
        console.warn(
          `[sync] waiting for leaf ${expected} before ${d.leafIndex} (gap)`
        );
        break;
      }

      const {leafIndex, root} = await this.tree.insert(d.commitment);
      if (leafIndex !== d.leafIndex) {
        throw new Error(
          `leafIndex mismatch: event=${d.leafIndex} tree=${leafIndex} commitment=${d.commitment}`
        );
      }

      await this.deposits.markFinalized(d.id!);
      await this.roots.upsert(root, this.tree.size, d.blockNumber);
      await this.sync.update({lastRoot: root});

      try {
        if (
          this.goldskyRoots &&
          (await this.goldskyRoots.isRootPosted(root))
        ) {
          await this.roots.markPosted(root, "goldsky");
        } else {
          const tx = await this.poster.postRoot(root as Hex);
          if (tx) await this.roots.markPosted(root, tx);
        }
      } catch (err) {
        console.error(
          `[sync] postRoot failed for ${root}:`,
          err instanceof Error ? err.message : err
        );
      }

      count++;
      console.log(
        `[sync] finalized leaf=${leafIndex} commitment=${d.commitment.slice(0, 18)}… root=${root.slice(0, 18)}…`
      );
    }
    return count;
  }

  async getWitness(commitment: string): Promise<WitnessResponse | null> {
    const dep = await this.deposits.findByCommitment(commitment);
    if (!dep || !dep.finalized) return null;
    return this.tree.witness(dep.leafIndex);
  }

  processEventForTest(ev: DepositEvent): Promise<boolean> {
    return this.deposits.insertIgnore({
      commitment: ev.commitment,
      leafIndex: ev.leafIndex,
      token: ev.token,
      amount: ev.amount.toString(),
      blockNumber: ev.blockNumber,
      blockHash: ev.blockHash,
      txHash: ev.txHash,
      logIndex: ev.logIndex,
      finalized: false,
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const {ingested, finalized} = await this.tick();
        if (ingested || finalized) {
          console.log(`[sync] tick ingested=${ingested} finalized=${finalized}`);
        }
      } catch (err) {
        console.error(
          "[sync] tick error:",
          err instanceof Error ? err.message : err
        );
      }
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, config.pollIntervalMs);
      });
    }
  }
}
