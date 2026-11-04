'use client';

import { useState } from 'react';
import { controlResetCustomerPassword } from './actions';

export default function CustomerPasswordResetModal({
  tenantId, companyName, adminEmail, onClose,
}: {
  tenantId:string; companyName:string; adminEmail:string; onClose:()=>void;
}) {
  const [email,setEmail]=useState(adminEmail);
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [password,setPassword]=useState('');
  async function reset(){
    if(!confirm||busy)return;
    setBusy(true);setError('');
    try{
      const result=await controlResetCustomerPassword(tenantId,email);
      if(!result.ok){setError(String(result.error||'Não foi possível redefinir a senha.'));return;}
      setPassword(String(result.temporary_password||''));
    }catch{setError('Falha ao redefinir senha. Tente novamente.');}
    finally{setBusy(false);}
  }
  return <div className="control-modal-bg"><section className="control-modal wide" role="dialog" aria-modal="true" aria-label="Redefinir senha">
    <header><div><small>SUPORTE AO CLIENTE</small><h2>Redefinir senha de acesso</h2></div><button type="button" onClick={onClose}>×</button></header>
    <p><strong>Empresa:</strong> {companyName}</p>
    {password ? <>
      <p>Senha temporária gerada. Ela será exibida somente nesta tela; o usuário precisará trocá-la no primeiro acesso. As sessões anteriores foram encerradas.</p>
      <div className="credential"><span>E-mail</span><strong>{email}</strong></div>
      <div className="credential"><span>Senha temporária</span><strong>{password}</strong></div>
      <footer><button type="button" onClick={()=>{void navigator.clipboard.writeText(password);}}>Copiar senha</button><button type="button" className="control-primary" onClick={onClose}>Concluir</button></footer>
    </> : <>
      <p>Confirme o e-mail do administrador desta empresa. Uma nova senha temporária será gerada e todas as sessões anteriores serão invalidadas.</p>
      <label>E-mail do usuário<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="off"/></label>
      <label style={{display:'flex',gap:8,alignItems:'center',marginTop:12}}><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> Confirmo que estou autorizado a redefinir a senha deste usuário.</label>
      {error&&<p className="error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="control-primary" disabled={!confirm||busy||!email.includes('@')} onClick={()=>void reset()}>{busy?'Processando...':'Gerar nova senha temporária'}</button></footer>
    </>}
  </section></div>;
}
