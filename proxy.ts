import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

const SESSION_COOKIE = 'thorpdv_test_session';
function licensedModule(pathname:string){
  if(/^\/dashboard\/(clientes|fornecedores|perfis-pdv|usuarios-pdv|perfis-adm|usuarios-adm)/.test(pathname))return 'people';
  if(pathname.startsWith('/dashboard/vendas'))return 'sales';
  if(/^\/dashboard\/(produtos|grupos|classes|modificadores)/.test(pathname))return 'products';
  if(pathname.startsWith('/dashboard/tabelas-precos')||pathname.startsWith('/dashboard/promocoes'))return 'pricing';
  if(pathname.startsWith('/dashboard/estoque/producao'))return 'production';
  if(pathname.startsWith('/dashboard/compras'))return 'purchases';
  if(pathname.startsWith('/dashboard/estoque'))return 'stock';
  if(pathname.startsWith('/dashboard/financeiro'))return 'finance';
  if(pathname.startsWith('/dashboard/fiscal'))return 'fiscal';
  if(pathname.startsWith('/dashboard/integracoes'))return 'integrations';
  if(pathname.startsWith('/dashboard/relatorios'))return 'reports';
  if(pathname.startsWith('/dashboard/atendimento'))return 'support';
  if(pathname.startsWith('/dashboard/administrativo/pdvs')||pathname.startsWith('/dashboard/administrativo/pdv-desktop')||pathname.startsWith('/dashboard/pdv/caixa'))return 'pdv';
  if(pathname.startsWith('/dashboard/administrativo')||pathname.startsWith('/dashboard/configuracoes'))return 'administration';
  return null;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let tempStatus: { ok?: boolean; must_change_password?: boolean } | null = null;

  if (!user && token) { const { data } = await supabase.rpc('temp_session_status', { p_token: token }); tempStatus = data as { ok?: boolean; must_change_password?: boolean } | null; }
  const hasTempSession = Boolean(tempStatus?.ok);
  const mustChangePassword = Boolean(tempStatus?.must_change_password);

  if (pathname.startsWith('/dashboard')) {
    if (!user && !hasTempSession) { const url = request.nextUrl.clone(); url.pathname = '/login'; return NextResponse.redirect(url); }
    if (!user && hasTempSession && mustChangePassword) { const url = request.nextUrl.clone(); url.pathname = '/change-password'; return NextResponse.redirect(url); }
    const module=licensedModule(pathname);
    if(module && token && hasTempSession){
      const {data}=await supabase.rpc('erp_license_get',{p_token:token});
      const license=data as {ok?:boolean;status?:string;modules?:Record<string,boolean>}|null;
      const active=license?.ok&&(license.status==='active'||license.status==='trial');
      if(!active||license?.modules?.[module]!==true){const url=request.nextUrl.clone();url.pathname='/dashboard';url.searchParams.set('license_blocked',module);return NextResponse.redirect(url);}
    }
  }

  if (pathname === '/change-password') {
    if (user) { const url = request.nextUrl.clone(); url.pathname = '/dashboard'; return NextResponse.redirect(url); }
    if (!hasTempSession) { const url = request.nextUrl.clone(); url.pathname = '/login'; return NextResponse.redirect(url); }
    if (!mustChangePassword) { const url = request.nextUrl.clone(); url.pathname = '/dashboard'; return NextResponse.redirect(url); }
  }

  if (pathname === '/login') {
    if (user || (hasTempSession && !mustChangePassword)) { const url = request.nextUrl.clone(); url.pathname = '/dashboard'; return NextResponse.redirect(url); }
    if (hasTempSession && mustChangePassword) { const url = request.nextUrl.clone(); url.pathname = '/change-password'; return NextResponse.redirect(url); }
  }

  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
