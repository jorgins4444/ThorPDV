require('./agent/product-images-v090').installProductImagesV090();
require('./main.js');

const { ThorAgent } = require('./agent');
const { Store } = require('./agent/store');
require('./agent/product-rules-v046').installProductRules(ThorAgent, Store);
require('./agent/queue-reconcile-v104').installQueueReconcileV104(Store);
