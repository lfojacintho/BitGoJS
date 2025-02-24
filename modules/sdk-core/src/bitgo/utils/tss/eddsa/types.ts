import { EDDSA } from '../../../../account-lib/mpc/tss';
import BaseTSSUtils from '../baseTSSUtils';
import { UnsignedTransactionTss } from '../baseTypes';

export type KeyShare = EDDSA.KeyShare;
export type YShare = EDDSA.YShare;
/** @deprected use UnsignedTransactionTss from baseTypes */
export type EddsaUnsignedTransaction = UnsignedTransactionTss;

export type IEddsaUtils = BaseTSSUtils<KeyShare>;
/** @deprecated Use IEddsaUtils */
export type ITssUtils = IEddsaUtils;

// For backward compatibility
export {
  PrebuildTransactionWithIntentOptions,
  TxRequestVersion,
  TxRequestState,
  TransactionState,
  SignatureShareRecord,
  SignatureShareType,
} from '../baseTypes';
