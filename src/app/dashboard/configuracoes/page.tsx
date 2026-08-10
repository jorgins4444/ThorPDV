import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/organization.css';
import '../[...slug]/branch-config.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { BranchConfigWorkspace } from '../[...slug]/branch-config-workspace';
import { SmartPosPairingPanel } from '../[...slug]/smartpos-pairing-panel';
import { erpLoad } from '../[...slug]/actions';

export default async function SettingsPage(){
  const branches=await erpLoad('branches');
  return <AdvancedShell
    title="Configurações da Filial"
    subtitle="Centralize parâmetros operacionais, fiscais, terminais, integrações e opções comerciais por filial."
    activePath="/dashboard/configuracoes"
  >
    <section className="erp-module-card" style={{padding:20,marginBottom:18}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'center',flexWrap:'wrap'}}>
        <div><small style={{fontSize:10,fontWeight:800,letterSpacing:'.09em',color:'#628078'}}>VENDAS E RECEBIMENTOS</small><h2 style={{margin:'4px 0 5px'}}>Opções de Vendas</h2><p style={{margin:0,color:'#65766f',fontSize:12,maxWidth:760}}>Configure formas de pagamento, bandeiras, credenciadoras, cartão de crédito 1x a 12x, Boleto e Crediário em um único lugar.</p></div>
        <Link className="erp-primary" href="/dashboard/configuracoes/opcoes-vendas">Abrir Opções de Vendas →</Link>
      </div>
    </section>
    <div className="erp-org-grid">{branches.data.length?<><BranchConfigWorkspace branches={branches.data}/><SmartPosPairingPanel branches={branches.data}/></>:<section className="erp-module-card erp-advanced-panel"><h2>Nenhuma filial cadastrada</h2><p>Cadastre uma filial em Administrativo → Empresas e Filiais antes de configurar a operação.</p></section>}</div>
  </AdvancedShell>;
}
