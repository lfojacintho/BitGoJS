import { AddressFormat, BaseUtils } from '@bitgo/sdk-core';
import {
  Address,
  BaseAddress,
  PublicKey,
  Ed25519Signature,
  NetworkInfo,
  StakeCredential,
} from '@emurgo/cardano-serialization-lib-nodejs';
import { KeyPair } from './keyPair';

export class Utils implements BaseUtils {
  createBaseAddressWithStakeAndPaymentKey(
    stakeKeyPair: KeyPair,
    paymentKeyPair: KeyPair,
    network: AddressFormat
  ): string {
    let baseAddr;
    if (network === AddressFormat.mainnet) {
      // 1. create stake pubKey
      const key = stakeKeyPair.getKeys().pub;

      const stakePub = PublicKey.from_bytes(Buffer.from(key, 'hex'));
      // 2. create payment pubKey
      const paymentPub = PublicKey.from_bytes(Buffer.from(paymentKeyPair.getKeys().pub, 'hex'));
      // 3. create full base address for staking
      baseAddr = BaseAddress.new(
        NetworkInfo.mainnet().network_id(),
        StakeCredential.from_keyhash(paymentPub.hash()),
        StakeCredential.from_keyhash(stakePub.hash())
      );
      return baseAddr.to_address().to_bech32();
    } else if (network === AddressFormat.testnet) {
      // 1. create stake pubKey
      const stakePub = PublicKey.from_bytes(Buffer.from(stakeKeyPair.getKeys().pub, 'hex'));
      // 2. create payment pubKey
      const paymentPub = PublicKey.from_bytes(Buffer.from(paymentKeyPair.getKeys().pub, 'hex'));
      // 3. create full base address for staking
      const baseAddr = BaseAddress.new(
        NetworkInfo.testnet().network_id(),
        StakeCredential.from_keyhash(paymentPub.hash()),
        StakeCredential.from_keyhash(stakePub.hash())
      );
      return baseAddr.to_address().to_bech32();
    } else {
      throw new Error('Improper Network Type!');
    }
  }

  validateBlake2b(hash: string): boolean {
    if (!hash) {
      return false;
    }
    if (hash.length !== 64) {
      return false;
    }
    return hash.match(/^[a-zA-Z0-9]+$/) !== null;
  }

  /** @inheritdoc */
  // this will validate both stake and payment addresses
  isValidAddress(address: string): boolean {
    try {
      Address.from_bech32(address);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** @inheritdoc */
  isValidBlockId(hash: string): boolean {
    return this.validateBlake2b(hash);
  }

  /** @inheritdoc */
  isValidPrivateKey(key: string): boolean {
    // this will return true for both extended and non-extended ED25519 keys
    return this.isValidKey(key);
  }

  isValidKey(key: string): boolean {
    try {
      new KeyPair({ prv: key });
      return true;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  isValidPublicKey(pubKey: string): boolean {
    try {
      new KeyPair({ pub: pubKey });
      return true;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  isValidSignature(signature: string): boolean {
    try {
      Ed25519Signature.from_hex(signature);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** @inheritdoc */
  isValidTransactionId(txId: string): boolean {
    return this.validateBlake2b(txId);
  }
}

const utils = new Utils();

export default utils;
