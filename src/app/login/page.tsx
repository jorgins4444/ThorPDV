import Link from 'next/link';
import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-wrap">
      <section className="card auth-card">
        <Link href="/" className="brand">THOR<span>PDV</span></Link>
        <h1>Acessar Thor Gestão</h1>
        <p className="muted">
          Entre com o e-mail cadastrado pelo ThorControl. No primeiro acesso, use a senha temporária recebida na implantação; o sistema solicitará a criação de uma nova senha.
        </p>

        {params.error ? <p className="error">{params.error}</p> : null}
        {params.message ? <p className="muted">{params.message}</p> : null}

        <form className="form">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              placeholder="administrador@empresa.com.br"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={8}
              required
            />
          </div>
          <button className="button" formAction={login}>Entrar</button>
        </form>
      </section>
    </main>
  );
}
