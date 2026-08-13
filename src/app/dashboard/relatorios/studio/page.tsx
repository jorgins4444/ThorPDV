import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import '../../[...slug]/module.css';
import '../../[...slug]/management-shell.css';
import './report-studio.css';
import { ReportStudio } from './report-studio-client';

export default async function ReportStudioPage(){
 const branches=await erpLoad('branches');
 return <AdvancedShell title="Report Studio" subtitle="Crie workbooks gerenciais, combine relatórios, compare períodos e personalize cada análise." activePath="/dashboard/relatorios">
  <ReportStudio branches={Array.isArray(branches.data)?branches.data:[]}/>
 </AdvancedShell>;
}
