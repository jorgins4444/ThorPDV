const core=require('./index.js');
const {installOperationsServerV125}=require('./operations-server-v125');
installOperationsServerV125(core.ThorAgent);
module.exports=core;
