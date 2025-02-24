import * as _ from 'lodash';
import * as common from '../../common';
import { IBaseCoin, KeychainsTriplet, KeyPair } from '../baseCoin';
import { BitGoBase } from '../bitgoBase';
import { BlsUtils, RequestTracer, EDDSAUtils, ECDSAUtils } from '../utils';
import {
  AddKeychainOptions,
  ChangedKeychains,
  CreateBackupOptions,
  CreateBitGoOptions,
  CreateMpcOptions,
  GetKeychainOptions,
  GetKeysForSigningOptions,
  IKeychains,
  Keychain,
  ListKeychainOptions,
  ListKeychainsResult,
  UpdatePasswordOptions,
  UpdateSingleKeychainPasswordOptions,
} from './iKeychains';

export class Keychains implements IKeychains {
  private readonly bitgo: BitGoBase;
  private readonly baseCoin: IBaseCoin;

  constructor(bitgo: BitGoBase, baseCoin: IBaseCoin) {
    this.bitgo = bitgo;
    this.baseCoin = baseCoin;
  }

  /**
   * Get a keychain by ID
   * @param params
   * @param params.id
   * @param params.xpub (optional)
   * @param params.ethAddress (optional)
   * @param params.reqId (optional)
   */
  async get(params: GetKeychainOptions): Promise<Keychain> {
    common.validateParams(params, [], ['xpub', 'ethAddress']);

    if (_.isUndefined(params.id)) {
      throw new Error('id must be defined');
    }

    const id = params.id;
    if (params.reqId) {
      this.bitgo.setRequestTracer(params.reqId);
    }
    return await this.bitgo.get(this.baseCoin.url('/key/' + encodeURIComponent(id))).result();
  }

  /**
   * list the users keychains
   * @param params
   * @param params.limit - Max number of results in a single call.
   * @param params.prevId - Continue iterating (provided by nextBatchPrevId in the previous list)
   * @returns {*}
   */
  async list(params: ListKeychainOptions = {}): Promise<ListKeychainsResult> {
    const queryObject: any = {};

    if (!_.isUndefined(params.limit)) {
      if (!_.isNumber(params.limit)) {
        throw new Error('invalid limit argument, expecting number');
      }
      queryObject.limit = params.limit;
    }
    if (!_.isUndefined(params.prevId)) {
      if (!_.isString(params.prevId)) {
        throw new Error('invalid prevId argument, expecting string');
      }
      queryObject.prevId = params.prevId;
    }

    return this.bitgo.get(this.baseCoin.url('/key')).query(queryObject).result();
  }

  /**
   * Change the decryption password for all possible keychains associated with a user.
   *
   * This function iterates through all keys associated with the user, decrypts
   * them with the old password and re-encrypts them with the new password.
   *
   * This should be called when a user changes their login password, and are expecting
   * that their wallet passwords are changed to match the new login password.
   *
   * @param params
   * @param params.oldPassword - The old password used for encrypting the key
   * @param params.newPassword - The new password to be used for encrypting the key
   * @returns changedKeys Object - e.g.:
   *  {
   *    xpub1: encryptedPrv,
   *    ...
   *  }
   */
  async updatePassword(params: UpdatePasswordOptions): Promise<ChangedKeychains> {
    common.validateParams(params, ['oldPassword', 'newPassword'], []);
    const changedKeys: ChangedKeychains = {};
    let prevId;
    let keysLeft = true;
    while (keysLeft) {
      const result: ListKeychainsResult = await this.list({ limit: 500, prevId });
      for (const key of result.keys) {
        const oldEncryptedPrv = key.encryptedPrv;
        if (_.isUndefined(oldEncryptedPrv)) {
          continue;
        }
        try {
          const updatedKeychain = this.updateSingleKeychainPassword({
            keychain: key,
            oldPassword: params.oldPassword,
            newPassword: params.newPassword,
          });
          if (updatedKeychain.encryptedPrv) {
            changedKeys[updatedKeychain.pub] = updatedKeychain.encryptedPrv;
          }
        } catch (e) {
          // if the password was incorrect, silence the error, throw otherwise
          if (!e.message.includes('private key is incorrect')) {
            throw e;
          }
        }
      }
      if (result.nextBatchPrevId) {
        prevId = result.nextBatchPrevId;
      } else {
        keysLeft = false;
      }
    }
    return changedKeys;
  }

  /**
   * Update the password used to decrypt a single keychain
   * @param params
   * @param params.keychain - The keychain whose password should be updated
   * @param params.oldPassword - The old password used for encrypting the key
   * @param params.newPassword - The new password to be used for encrypting the key
   * @returns {object}
   */
  updateSingleKeychainPassword(params: UpdateSingleKeychainPasswordOptions = {}): Keychain {
    if (!_.isString(params.oldPassword)) {
      throw new Error('expected old password to be a string');
    }

    if (!_.isString(params.newPassword)) {
      throw new Error('expected new password to be a string');
    }

    if (!_.isObject(params.keychain) || !_.isString(params.keychain.encryptedPrv)) {
      throw new Error('expected keychain to be an object with an encryptedPrv property');
    }

    const oldEncryptedPrv = params.keychain.encryptedPrv;
    try {
      const decryptedPrv = this.bitgo.decrypt({ input: oldEncryptedPrv, password: params.oldPassword });
      const newEncryptedPrv = this.bitgo.encrypt({ input: decryptedPrv, password: params.newPassword });
      return _.assign({}, params.keychain, { encryptedPrv: newEncryptedPrv });
    } catch (e) {
      // catching an error here means that the password was incorrect or, less likely, the input to decrypt is corrupted
      throw new Error('password used to decrypt keychain private key is incorrect');
    }
  }

  /**
   * Create a public/private key pair
   * @param params.seed
   */
  create(params: { seed?: Buffer } = {}): KeyPair {
    return this.baseCoin.generateKeyPair(params.seed);
  }

  /**
   * Add a keychain to BitGo's records
   * @param params
   */
  async add(params: AddKeychainOptions = {}): Promise<Keychain> {
    params = params || {};
    common.validateParams(
      params,
      [],
      [
        'pub',
        'encryptedPrv',
        'keyType',
        'type',
        'source',
        'originalPasscodeEncryptionCode',
        'enterprise',
        'derivedFromParentWithSeed',
      ]
    );

    if (!_.isUndefined(params.disableKRSEmail)) {
      if (!_.isBoolean(params.disableKRSEmail)) {
        throw new Error('invalid disableKRSEmail argument, expecting boolean');
      }
    }

    if (params.reqId) {
      this.bitgo.setRequestTracer(params.reqId);
    }

    return await this.bitgo
      .post(this.baseCoin.url('/key'))
      .send({
        pub: params.pub,
        commonPub: params.commonPub,
        commonKeychain: params.commonKeychain,
        encryptedPrv: params.encryptedPrv,
        type: params.type,
        keyType: params.keyType,
        source: params.source,
        provider: params.provider,
        originalPasscodeEncryptionCode: params.originalPasscodeEncryptionCode,
        enterprise: params.enterprise,
        derivedFromParentWithSeed: params.derivedFromParentWithSeed,
        disableKRSEmail: params.disableKRSEmail,
        krsSpecific: params.krsSpecific,
        keyShares: params.keyShares,
        userGPGPublicKey: params.userGPGPublicKey,
        backupGPGPublicKey: params.backupGPGPublicKey,
      })
      .result();
  }

  /**
   * Create a BitGo key
   * @param params (empty)
   */
  async createBitGo(params: CreateBitGoOptions = {}): Promise<Keychain> {
    params.source = 'bitgo';

    this.baseCoin.preCreateBitGo(params as any);
    return await this.add(params);
  }

  /**
   * Create a backup key
   * @param params
   * @param params.provider (optional)
   */
  async createBackup(params: CreateBackupOptions = {}): Promise<Keychain> {
    params.source = 'backup';

    const isTssBackupKey = params.prv && (params.commonKeychain || params.commonPub);

    if (_.isUndefined(params.provider) && !isTssBackupKey) {
      // if the provider is undefined, we generate a local key and add the source details
      const key = this.create();
      _.extend(params, key);
    }

    const serverResponse = await this.add(params);
    return _.extend({}, serverResponse, _.pick(params, ['prv', 'encryptedPrv', 'provider', 'source']));
  }

  /**
   * Gets keys for signing from a wallet
   * @param params
   * @returns {Promise<Keychain[]>}
   */
  async getKeysForSigning(params: GetKeysForSigningOptions = {}): Promise<Keychain[]> {
    if (!_.isObject(params.wallet)) {
      throw new Error('missing required param wallet');
    }
    const wallet = params.wallet;
    const reqId = params.reqId || new RequestTracer();
    const ids = wallet.baseCoin.keyIdsForSigning();
    const keychainQueriesBluebirds = ids.map((id) => this.get({ id: wallet.keyIds()[id], reqId }));
    return Promise.all(keychainQueriesBluebirds);
  }

  /**
   * Convenience function to create and store MPC keychains with BitGo.
   * @param params passphrase used to encrypt secret materials
   * @return {Promise<KeychainsTriplet>} newly created User, Backup, and BitGo keys
   */
  async createMpc(params: CreateMpcOptions): Promise<KeychainsTriplet> {
    let MpcUtils;
    switch (params.multisigType) {
      case 'tss':
        MpcUtils = this.baseCoin.getMPCAlgorithm() === 'ecdsa' ? ECDSAUtils.EcdsaUtils : EDDSAUtils.default;
        break;
      case 'blsdkg':
        if (_.isUndefined(params.passphrase)) {
          throw new Error('missing required param passphrase');
        }
        MpcUtils = BlsUtils;
        break;
      default:
        throw new Error('Unsupported multi-sig type');
    }

    const mpcUtils = new MpcUtils(this.bitgo, this.baseCoin);
    return await mpcUtils.createKeychains({
      passphrase: params.passphrase,
      enterprise: params.enterprise,
      originalPasscodeEncryptionCode: params.originalPasscodeEncryptionCode,
    });
  }
}
