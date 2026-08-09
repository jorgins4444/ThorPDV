import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/pdv-device.css';
import '../../[...slug]/management-shell.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { PdvDeviceWorkspace } from '../../[...slug]/pdv-device-workspace';
import { pdvDeviceList } from '../../[...slug]/pdv-device-actions';
import { erpLoad } from '../../[...slug]/actions';

export default async function PdvDesktopPage() {
  const [posRegisters, devices] = await Promise.all([erpLoad('pos_registers'), pdvDeviceList()]);
  return <AdvancedShell
    title="PDV Desktop / Agentes Windows"
    subtitle="Pareie computadores de caixa com o ThorERP, monitore o agente e controle a sincronização das operações."
    activePath="/dashboard/administrativo/pdv-desktop"
  >
    <PdvDeviceWorkspace posRegisters={posRegisters.data} initialDevices={devices.data} />
  </AdvancedShell>;
}
