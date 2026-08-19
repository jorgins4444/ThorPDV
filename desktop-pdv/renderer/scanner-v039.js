const scannerV039OriginalRenderSaleWorkspace = renderSaleWorkspace;

renderSaleWorkspace = function () {
  scannerV039OriginalRenderSaleWorkspace();
  const search = document.getElementById('search');
  if (!search) return;
  search.onkeydown = async event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = String(search.value || '').trim();
    if (!query) return;
    await refreshProducts(query);
    const product = state.products?.[0];
    if (!product) {
      showToast('Produto não encontrado.');
      search.select();
      return;
    }
    await add(product);
    search.select();
  };
};
