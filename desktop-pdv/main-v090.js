require('./agent/product-images-v090').installProductImagesV090();
require('./main.js');

const { ThorAgent } = require('./agent');
const { Store } = require('./agent/store');
require('./agent/product-rules-v046').installProductRules(ThorAgent, Store);
require('./agent/queue-reconcile-v104').installQueueReconcileV104(Store);
require('./agent/receipt-print-v829').installReceiptPrintingV829(ThorAgent, Store);
require('./agent/sale-identity-v830').installSaleIdentityV830(ThorAgent, Store);
require('./agent/store-credit-return-v105').installStoreCreditReturnV105(ThorAgent, Store);
require('./agent/return-quantity-guard-v106').installReturnQuantityGuardV106(ThorAgent);
require('./agent/store-credit-payment-v106').installStoreCreditPaymentV106(ThorAgent, Store);
require('./agent/cash-close-receipt-v112').installCashCloseReceiptV112(ThorAgent);
require('./agent/cash-close-print-layout-v113').installCashClosePrintLayoutV113(ThorAgent);
require('./agent/receivable-v115').installReceivableV115(ThorAgent);
require('./ipc-store-credit-v105').installStoreCreditVoucherIpcV105(ThorAgent);
