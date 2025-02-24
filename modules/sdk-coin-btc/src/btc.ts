import { AbstractUtxoCoin, UtxoNetwork } from '@bitgo/abstract-utxo';
import {
  BitGoBase,
  BaseCoin,
  VerifyRecoveryTransactionOptions as BaseVerifyRecoveryTransactionOptions,
} from '@bitgo/sdk-core';
import * as utxolib from '@bitgo/utxo-lib';

export interface VerifyRecoveryTransactionOptions extends BaseVerifyRecoveryTransactionOptions {
  transactionHex: string;
}

export class Btc extends AbstractUtxoCoin {
  constructor(bitgo: BitGoBase, network?: UtxoNetwork) {
    super(bitgo, network || utxolib.networks.bitcoin);
  }

  static createInstance(bitgo: BitGoBase): BaseCoin {
    return new Btc(bitgo);
  }

  getChain(): string {
    return 'btc';
  }

  getFamily(): string {
    return 'btc';
  }

  getFullName(): string {
    return 'Bitcoin';
  }

  supportsBlockTarget(): boolean {
    return true;
  }

  supportsLightning(): boolean {
    return true;
  }
}
