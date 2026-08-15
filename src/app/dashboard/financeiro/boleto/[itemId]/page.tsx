import '../../../[...slug]/itau-boleto-print.css';
import { cnabBoletoData } from '../../../[...slug]/bank-cnab-actions';
import { ItauBoletoPrint } from '../../../[...slug]/itau-boleto-print';

type Props={params:Promise<{itemId:string}>};

export default async function BoletoPage({params}:Props){
  const {itemId}=await params;
  const data=await cnabBoletoData(itemId);
  if(!data.ok){
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'Arial, sans-serif',background:'#f4f6f8'}}><section style={{background:'#fff',padding:28,border:'1px solid #dfe4ea',borderRadius:12,maxWidth:520}}><h1 style={{marginTop:0}}>Boleto não disponível</h1><p>Não foi possível carregar os dados deste boleto: {String(data.error||'registro não encontrado')}.</p><a href="/dashboard/financeiro/remessa-retorno">Voltar para Remessa / Retorno</a></section></main>;
  }
  return <ItauBoletoPrint data={data as Record<string,unknown>}/>;
}
