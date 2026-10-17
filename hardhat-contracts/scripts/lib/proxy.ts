import hre from "hardhat";
import type {BaseContract, Contract, ContractFactory} from "ethers";

/**
 * Alchemy (and some RPCs) reject a second tx while one is still pending for
 * EIP-7702 "delegated accounts" (`in-flight transaction limit reached`).
 * Wait until pending nonce catches up to the latest mined nonce.
 */
export async function waitForClearMempool(
  address: string,
  label = "mempool"
): Promise<void> {
  const provider = hre.ethers.provider;
  const started = Date.now();
  const timeoutMs = Number(process.env.DEPLOY_MEMPOOL_TIMEOUT_MS || 180_000);

  for (;;) {
    const latest = await provider.getTransactionCount(address, "latest");
    const pending = await provider.getTransactionCount(address, "pending");
    if (pending === latest) return;

    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for clear mempool (${label}): latest=${latest} pending=${pending}. ` +
          `Check https://celo-sepolia.blockscout.com/address/${address} for stuck txs, then retry.`
      );
    }
    console.log(
      `  … waiting for ${pending - latest} in-flight tx(s) to confirm (${label})`
    );
    await new Promise((r) => setTimeout(r, 2_500));
  }
}

/** Deploy + wait for receipt + clear mempool before returning. */
export async function deployAndWait<T extends Contract>(
  factory: ContractFactory,
  args: unknown[] = [],
  label?: string
): Promise<T> {
  const [signer] = await hre.ethers.getSigners();
  await waitForClearMempool(signer.address, label ? `${label} (pre)` : "pre-deploy");

  const contract = (await factory.deploy(...args)) as T;
  await contract.waitForDeployment();
  const tx = contract.deploymentTransaction();
  if (tx) await tx.wait(1);

  await waitForClearMempool(signer.address, label ? `${label} (post)` : "post-deploy");
  return contract;
}

/**
 * Deploy an implementation + ERC1967Proxy and return the proxy typed as `factory`.
 */
export async function deployUUPSProxy<T extends BaseContract>(
  factory: ContractFactory,
  initArgs: unknown[] = [],
  label = "proxy"
): Promise<T> {
  const impl = await deployAndWait(factory, [], `${label} impl`);
  const implAddr = await impl.getAddress();

  const initData = factory.interface.encodeFunctionData("initialize", initArgs);
  const Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
  const proxy = await deployAndWait(Proxy, [implAddr, initData], `${label} ERC1967`);

  return factory.attach(await proxy.getAddress()) as unknown as T;
}
