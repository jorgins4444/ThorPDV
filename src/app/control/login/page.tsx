import '../control.css';
import { controlLogin } from './actions';

export default async function ControlLoginPage({searchParams}:{searchParams:Promise<{error?:string}>}){
 const q=await searchParams;
 return <main className="control-auth-shell"><section className="control-auth-card"><div className="control-brand"><span>ϟ</span><div><strong>THOR CONTROL</strong><small>Administração da plataforma</small></div></div><div className="control-auth-copy"><small>ACESSO RESTRITO</small><h1>Central do proprietário</h1><p>Licenças, clientes, módulos, terminais e monitor fiscal em uma área separada do ERP das lojas.</p></div><form action={controlLogin} className="control-auth-form"><label>Email<input name="email" type="email" autoComplete="username" required placeholder="seu@email.com"/></label><label>Senha<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••••"/></label>{q.error&&<div className="control-alert error">{q.error}</div>}<button type="submit">Entrar no Thor Control</button></form><footer>Ambiente administrativo independente do Gestão.</footer></section></main>;
}
