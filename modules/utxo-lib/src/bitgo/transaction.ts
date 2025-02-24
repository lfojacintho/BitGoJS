import { TxOutput } from 'bitcoinjs-lib';

import { networks, Network, getMainnet } from '../networks';

import { UtxoTransaction } from './UtxoTransaction';
import { UtxoTransactionBuilder } from './UtxoTransactionBuilder';
import { DashTransaction } from './dash/DashTransaction';
import { DashTransactionBuilder } from './dash/DashTransactionBuilder';
import { ZcashTransactionBuilder } from './zcash/ZcashTransactionBuilder';
import { ZcashNetwork, ZcashTransaction } from './zcash/ZcashTransaction';
import { UtxoPsbt } from './UtxoPsbt';

export function createTransactionFromBuffer<TNumber extends number | bigint = number>(
  buf: Buffer,
  network: Network,
  { version }: { version?: number } = {},
  amountType: 'number' | 'bigint' = 'number'
): UtxoTransaction<TNumber> {
  switch (getMainnet(network)) {
    case networks.bitcoin:
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
    case networks.dogecoin:
    case networks.litecoin:
      return UtxoTransaction.fromBuffer<TNumber>(buf, false, amountType, network);
    case networks.dash:
      return DashTransaction.fromBuffer<TNumber>(buf, false, amountType, network);
    case networks.zcash:
      return ZcashTransaction.fromBufferWithVersion<TNumber>(buf, network as ZcashNetwork, version, amountType);
  }

  /* istanbul ignore next */
  throw new Error(`invalid network`);
}

/* istanbul ignore next */
export function createTransactionFromHex<TNumber extends number | bigint = number>(
  hex: string,
  network: Network,
  amountType: 'number' | 'bigint' = 'number'
): UtxoTransaction<TNumber> {
  return createTransactionFromBuffer<TNumber>(Buffer.from(hex, 'hex'), network, {}, amountType);
}

export function getDefaultTransactionVersion(network: Network): number {
  switch (getMainnet(network)) {
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
      return 2;
    case networks.zcash:
      return ZcashTransaction.VERSION4_BRANCH_NU5;
    default:
      return 1;
  }
}

export function setTransactionBuilderDefaults<TNumber extends number | bigint>(
  txb: UtxoTransactionBuilder<TNumber>,
  network: Network,
  { version = getDefaultTransactionVersion(network) }: { version?: number } = {}
): void {
  switch (getMainnet(network)) {
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
      if (version !== 2) {
        throw new Error(`invalid version`);
      }
      txb.setVersion(version);
      break;
    case networks.zcash:
      (txb as ZcashTransactionBuilder<TNumber>).setDefaultsForVersion(network, version);
      break;
    default:
      if (version !== 1) {
        throw new Error(`invalid version`);
      }
  }
}

export function setPsbtDefaults(
  psbt: UtxoPsbt<UtxoTransaction<bigint>>,
  network: Network,
  { version = getDefaultTransactionVersion(network) }: { version?: number } = {}
): void {
  switch (getMainnet(network)) {
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
      if (version !== 2) {
        throw new Error(`invalid version`);
      }
      break;
    default:
      if (version !== 1) {
        throw new Error(`invalid version`);
      }
  }
  // FIXME: Always call this, because there's a bug in the upstream PSBT that
  // defaults transactions to v2.
  psbt.setVersion(version);
}

export function createPsbtForNetwork(
  network: Network,
  { version }: { version?: number } = {}
): UtxoPsbt<UtxoTransaction<bigint>> {
  let psbt;

  switch (getMainnet(network)) {
    case networks.bitcoin:
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
    case networks.dogecoin:
    case networks.litecoin: {
      psbt = new UtxoPsbt({ network });
      break;
    }
    case networks.dash:
      throw new Error('Dash psbt not implemented');
    case networks.zcash: {
      throw new Error('Zcash psbt not implemented');
    }
    default:
      throw new Error(`unsupported network`);
  }

  setPsbtDefaults(psbt, network, { version });

  return psbt;
}

export function createTransactionBuilderForNetwork<TNumber extends number | bigint = number>(
  network: Network,
  { version }: { version?: number } = {}
): UtxoTransactionBuilder<TNumber> {
  let txb;
  switch (getMainnet(network)) {
    case networks.bitcoin:
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
    case networks.dogecoin:
    case networks.litecoin: {
      txb = new UtxoTransactionBuilder<TNumber>(network);
      break;
    }
    case networks.dash:
      txb = new DashTransactionBuilder<TNumber>(network);
      break;
    case networks.zcash: {
      txb = new ZcashTransactionBuilder<TNumber>(network as ZcashNetwork);
      break;
    }
    default:
      throw new Error(`unsupported network`);
  }

  setTransactionBuilderDefaults<TNumber>(txb, network, { version });

  return txb;
}

export function createTransactionBuilderFromTransaction<TNumber extends number | bigint>(
  tx: UtxoTransaction<TNumber>,
  prevOutputs?: TxOutput<TNumber>[]
): UtxoTransactionBuilder<TNumber> {
  switch (getMainnet(tx.network)) {
    case networks.bitcoin:
    case networks.bitcoincash:
    case networks.bitcoinsv:
    case networks.bitcoingold:
    case networks.dogecoin:
    case networks.litecoin:
      return UtxoTransactionBuilder.fromTransaction<TNumber>(tx, undefined, prevOutputs);
    case networks.dash:
      return DashTransactionBuilder.fromTransaction<TNumber>(
        tx as DashTransaction<TNumber>,
        undefined,
        prevOutputs as TxOutput<TNumber>[]
      );
    case networks.zcash:
      return ZcashTransactionBuilder.fromTransaction<TNumber>(
        tx as ZcashTransaction<TNumber>,
        undefined,
        prevOutputs as TxOutput<TNumber>[]
      );
  }

  throw new Error(`invalid network`);
}
