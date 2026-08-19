function installFiscalStartupGuardV091(ThorAgent) {
  if (ThorAgent.prototype.__fiscalStartupGuardV091) return;
  ThorAgent.prototype.__fiscalStartupGuardV091 = true;

  const originalFiscalSales = ThorAgent.prototype.fiscalSales;

  ThorAgent.prototype.fiscalSales = function (query = '') {
    const operator = typeof this.currentOperator === 'function' ? this.currentOperator() : null;
    if (!operator) return [];
    return originalFiscalSales.call(this, query);
  };
}

module.exports = { installFiscalStartupGuardV091 };
