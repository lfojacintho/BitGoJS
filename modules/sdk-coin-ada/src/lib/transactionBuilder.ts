import BigNumber from 'bignumber.js';
import { BaseCoin as CoinConfig } from '@bitgo/statics';
import {
  BaseAddress,
  BaseKey,
  BaseTransactionBuilder,
  BuildTransactionError,
  PublicKey as BasePublicKey,
  Signature,
  TransactionType,
  UtilsError,
} from '@bitgo/sdk-core';
import { Transaction, TransactionInput, TransactionOutput, Withdrawal } from './transaction';
import { KeyPair } from './keyPair';
import util from './utils';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { BigNum } from '@emurgo/cardano-serialization-lib-nodejs';

export abstract class TransactionBuilder extends BaseTransactionBuilder {
  protected _transaction!: Transaction;
  protected _signers: KeyPair[] = [];
  protected _transactionInputs: TransactionInput[] = [];
  protected _transactionOutputs: TransactionOutput[] = [];
  protected _signatures: Signature[] = [];
  protected _changeAddress: string;
  protected _senderBalance: string;
  protected _ttl = 0;
  protected _certs: CardanoWasm.Certificate[] = [];
  protected _withdrawals: Withdrawal[] = [];
  protected _type: TransactionType;

  constructor(_coinConfig: Readonly<CoinConfig>) {
    super(_coinConfig);
    this.transaction = new Transaction(_coinConfig);
  }

  input(i: TransactionInput): this {
    this._transactionInputs.push(i);
    return this;
  }

  output(o: TransactionOutput): this {
    this._transactionOutputs.push(o);
    return this;
  }

  ttl(t: number): this {
    this._ttl = t;
    return this;
  }

  changeAddress(addr: string, totalInputBalance: string): this {
    this._changeAddress = addr;
    this._senderBalance = totalInputBalance;
    return this;
  }

  /**
   * Initialize the transaction builder fields using the decoded transaction data
   *
   * @param {Transaction} tx the transaction data
   */
  initBuilder(tx: Transaction): void {
    this._transaction = tx;
    const txnBody = tx.transaction.body();
    for (let i = 0; i < txnBody.inputs().len(); i++) {
      const input = txnBody.inputs().get(i);
      this.input({
        transaction_id: Buffer.from(input.transaction_id().to_bytes()).toString('hex'),
        transaction_index: input.index(),
      });
    }
    for (let i = 0; i < txnBody.outputs().len(); i++) {
      const output = txnBody.outputs().get(i);
      this.output({
        address: output.address().to_bech32(),
        amount: output.amount().coin().to_str(),
      });
    }

    if (txnBody.certs() !== undefined) {
      const certs = txnBody.certs() as CardanoWasm.Certificates;
      for (let i = 0; i < certs.len(); i++) {
        this._certs.push(certs.get(i));
      }
    }

    if (txnBody.withdrawals() !== undefined) {
      const withdrawals = txnBody.withdrawals() as CardanoWasm.Withdrawals;
      const keys = withdrawals.keys();
      for (let i = 0; i < keys.len(); i++) {
        const rewardAddress = keys.get(i) as CardanoWasm.RewardAddress;
        const reward = withdrawals.get(rewardAddress) as CardanoWasm.BigNum;
        this._withdrawals.push({ stakeAddress: rewardAddress.to_address().to_bech32(), value: reward.to_str() });
      }
    }

    this._ttl = tx.transaction.body().ttl() as number;
  }

  /** @inheritdoc */
  protected fromImplementation(rawTransaction: string): Transaction {
    this.validateRawTransaction(rawTransaction);
    this.buildImplementation();
    return this.transaction;
  }

  /** @inheritdoc */
  protected async buildImplementation(): Promise<Transaction> {
    const inputs = CardanoWasm.TransactionInputs.new();
    this._transactionInputs.forEach((input) => {
      inputs.add(
        CardanoWasm.TransactionInput.new(
          CardanoWasm.TransactionHash.from_bytes(Buffer.from(input.transaction_id, 'hex')),
          input.transaction_index
        )
      );
    });
    let outputs = CardanoWasm.TransactionOutputs.new();
    let totalAmountToSend = CardanoWasm.BigNum.zero();
    this._transactionOutputs.forEach((output) => {
      const amount = CardanoWasm.BigNum.from_str(output.amount);
      outputs.add(
        CardanoWasm.TransactionOutput.new(
          CardanoWasm.Address.from_bech32(output.address),
          CardanoWasm.Value.new(amount)
        )
      );
      totalAmountToSend = totalAmountToSend.checked_add(amount);
    });

    // add extra output for the change
    if (this._changeAddress && this._senderBalance) {
      const changeAddress = CardanoWasm.Address.from_bech32(this._changeAddress);
      const mockChange = CardanoWasm.TransactionOutput.new(
        changeAddress,
        CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(this._senderBalance))
      );
      outputs.add(mockChange);
    }

    const txBody = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, CardanoWasm.BigNum.zero());
    txBody.set_ttl(CardanoWasm.BigNum.from_str(this._ttl.toString()));
    const txHash = CardanoWasm.hash_transaction(txBody);

    // we add witnesses once so that we can get the appropriate amount of signers for calculating the fee
    let witnessSet = CardanoWasm.TransactionWitnessSet.new();
    let vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    this._signers.forEach((keyPair) => {
      const prv = keyPair.getKeys().prv as string;
      const vkeyWitness = CardanoWasm.make_vkey_witness(
        txHash,
        CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(prv, 'hex'))
      );
      vkeyWitnesses.add(vkeyWitness);
    });
    this._signatures.forEach((signature) => {
      const vkey = CardanoWasm.Vkey.new(CardanoWasm.PublicKey.from_bytes(Buffer.from(signature.publicKey.pub, 'hex')));
      const ed255Sig = CardanoWasm.Ed25519Signature.from_bytes(signature.signature);
      vkeyWitnesses.add(CardanoWasm.Vkeywitness.new(vkey, ed255Sig));
    });
    if (vkeyWitnesses.len() === 0) {
      const prv = CardanoWasm.PrivateKey.generate_ed25519();
      const vkeyWitness = CardanoWasm.make_vkey_witness(txHash, prv);
      vkeyWitnesses.add(vkeyWitness);
      if (this._type !== TransactionType.Send) {
        vkeyWitnesses.add(vkeyWitness);
      }
    }
    witnessSet.set_vkeys(vkeyWitnesses);

    // add in withdrawal if this is a withdrawal tx
    if (this._withdrawals.length > 0) {
      const withdrawals = CardanoWasm.Withdrawals.new();
      this._withdrawals.forEach((withdrawal: Withdrawal) => {
        const rewardAddress = CardanoWasm.RewardAddress.from_address(
          CardanoWasm.Address.from_bech32(withdrawal.stakeAddress)
        );
        withdrawals.insert(rewardAddress!, CardanoWasm.BigNum.from_str(withdrawal.value));
      });

      txBody.set_withdrawals(withdrawals);
    }

    // add in certificates to get mock size
    const draftCerts = CardanoWasm.Certificates.new();
    for (const cert of this._certs) {
      draftCerts.add(cert);
    }
    txBody.set_certs(draftCerts);

    const txDraft = CardanoWasm.Transaction.new(txBody, witnessSet);
    const linearFee = CardanoWasm.LinearFee.new(
      CardanoWasm.BigNum.from_str('44'),
      CardanoWasm.BigNum.from_str('155381')
    );

    // calculate the fee based off our dummy transaction
    const fee = CardanoWasm.min_fee(txDraft, linearFee).checked_add(BigNum.from_str('440'));
    this._transaction.fee(fee.to_str());

    // now calculate the change based off of <utxoBalance> - <fee> - <amountToSend>
    // reset the outputs collection because now our last output has changed
    outputs = CardanoWasm.TransactionOutputs.new();
    this._transactionOutputs.forEach((output) => {
      outputs.add(
        CardanoWasm.TransactionOutput.new(
          CardanoWasm.Address.from_bech32(output.address),
          CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(output.amount))
        )
      );
    });
    if (this._changeAddress && this._senderBalance) {
      const changeAddress = CardanoWasm.Address.from_bech32(this._changeAddress);
      const utxoBalance = CardanoWasm.BigNum.from_str(this._senderBalance);

      const adjustment = BigNum.from_str('2000000');
      let change = utxoBalance.checked_sub(fee).checked_sub(totalAmountToSend);
      if (this._type === TransactionType.StakingActivate) {
        change = change.checked_sub(adjustment);
      } else if (this._type === TransactionType.StakingDeactivate) {
        change = change.checked_add(adjustment);
      } else if (this._type == TransactionType.StakingWithdraw) {
        this._withdrawals.forEach((withdrawal: Withdrawal) => {
          change = change.checked_add(CardanoWasm.BigNum.from_str(withdrawal.value));
        });
      }

      const changeOutput = CardanoWasm.TransactionOutput.new(changeAddress, CardanoWasm.Value.new(change));
      outputs.add(changeOutput);
    }

    const txRaw = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, fee);

    const certs = CardanoWasm.Certificates.new();
    for (const cert of this._certs) {
      certs.add(cert);
    }
    txRaw.set_certs(certs);

    // add in withdrawal if this is a withdrawal tx
    if (this._withdrawals.length > 0) {
      const withdrawals = CardanoWasm.Withdrawals.new();
      this._withdrawals.forEach((withdrawal: Withdrawal) => {
        const rewardAddress = CardanoWasm.RewardAddress.from_address(
          CardanoWasm.Address.from_bech32(withdrawal.stakeAddress)
        );
        withdrawals.insert(rewardAddress!, CardanoWasm.BigNum.from_str(withdrawal.value));
      });

      txRaw.set_withdrawals(withdrawals);
    }

    txRaw.set_ttl(CardanoWasm.BigNum.from_str(this._ttl.toString()));
    const txRawHash = CardanoWasm.hash_transaction(txRaw);

    // now add the witnesses again this time for real. We need to do this again
    // because now that we've added our real fee and change output, we have a difference transaction hash
    witnessSet = CardanoWasm.TransactionWitnessSet.new();
    vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    this._signers.forEach((keyPair) => {
      const prv = keyPair.getKeys().prv as string;
      const vkeyWitness = CardanoWasm.make_vkey_witness(
        txRawHash,
        CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(prv, 'hex'))
      );
      vkeyWitnesses.add(vkeyWitness);
    });
    this._signatures.forEach((signature) => {
      const vkey = CardanoWasm.Vkey.new(CardanoWasm.PublicKey.from_bytes(Buffer.from(signature.publicKey.pub, 'hex')));
      const ed255Sig = CardanoWasm.Ed25519Signature.from_bytes(signature.signature);
      vkeyWitnesses.add(CardanoWasm.Vkeywitness.new(vkey, ed255Sig));
    });
    witnessSet.set_vkeys(vkeyWitnesses);

    this._transaction.transaction = CardanoWasm.Transaction.new(txRaw, witnessSet);
    return this.transaction;
  }

  /** @inheritdoc */
  protected signImplementation(key: BaseKey): Transaction {
    this._signers.push(new KeyPair({ prv: key.key }));
    return this._transaction;
  }

  /** @inheritdoc */
  protected get transaction(): Transaction {
    return this._transaction;
  }

  /** @inheritdoc */
  protected set transaction(transaction: Transaction) {
    this._transaction = transaction;
  }

  /** @inheritdoc */
  validateAddress(address: BaseAddress, addressFormat?: string): void {
    if (!util.isValidAddress(address.address)) {
      throw new UtilsError('invalid address ' + address.address);
    }
  }

  /** @inheritdoc */
  validateKey(key: BaseKey): void {
    try {
      new KeyPair({ prv: key.key });
    } catch {
      throw new BuildTransactionError(`Key validation failed`);
    }
  }

  /** @inheritdoc */
  validateRawTransaction(rawTransaction: any): void {
    try {
      CardanoWasm.Transaction.from_bytes(rawTransaction);
    } catch {
      throw new BuildTransactionError('invalid raw transaction');
    }
  }

  /** @inheritdoc */
  validateTransaction(transaction: Transaction): void {
    if (!transaction.transaction) {
      return;
    }
  }

  /** @inheritdoc */
  validateValue(value: BigNumber): void {
    if (value.isLessThan(0)) {
      throw new BuildTransactionError('Value cannot be less than zero');
    }
  }
  // endregion

  /** @inheritDoc */
  addSignature(publicKey: BasePublicKey, signature: Buffer): void {
    this._signatures.push({ publicKey, signature });
  }
}
